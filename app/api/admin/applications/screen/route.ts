import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rateLimit'
import { getSession } from '@/lib/session'
import { canReviewApplications, canActInCity } from '@/lib/access'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canReviewApplications(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const app = await prisma.memberApplication.findUnique({
    where: { id },
    select: {
      fullName: true, country: true, city: true, profession: true,
      timeInCity: true, reasonHere: true, whyJoin: true,
      enjoyWith: true, goodCommunity: true, interests: true,
      contribution: true, groupBehavior: true,
      removedFromCommunity: true, toxicBehavior: true,
      bio: true, source: true, referredBy: true,
      instagram: true, linkedin: true,
      targetCityId: true,
    },
  })

  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // The list view scopes moderators to their own city's applications, but
  // this route accepted any id — and feeds the whole application (name,
  // socials, bio) into the response. Same rule as the list: admins
  // everywhere, moderators only their own city's applicants.
  if (!canActInCity(session, app.targetCityId)) {
    return NextResponse.json({ error: 'Cross-city review is admin-only' }, { status: 403 })
  }
  // Rate-limit the actual OpenAI call — after auth, so a cross-city probe
  // doesn't spend the budget. A loop on one id would otherwise be unbounded
  // spend + applicant PII shipped off-platform repeatedly.
  if (!await rateLimit(`ai-screen:${session.id}`, 15, 60_000)) {
    return NextResponse.json({ error: 'Rate limit — wait a moment' }, { status: 429 })
  }

  const prompt = `You are a community manager for Smileys, a curated social community in Istanbul for international and local residents who want genuine connection, shared experiences, and a sense of belonging. The community is application-based, English-first, and values people who are curious, kind, contribute to group energy, and attend events regularly.

Review this membership application and respond with a JSON object in exactly this format:
{
  "recommendation": "approve" | "review" | "reject",
  "confidence": number (0-100),
  "summary": "2-3 sentence plain-English summary of this applicant",
  "strengths": ["strength 1", "strength 2"],
  "redFlags": ["flag 1", "flag 2"],
  "suggestedQuestions": ["question to ask if reviewing or borderline"]
}

Rules:
- "approve" = clear fit, genuine answers, good energy, no red flags
- "review" = uncertain, generic answers, missing info, or needs a follow-up call
- "reject" = clear mismatch, toxic history, bad faith answers, or spam
- redFlags should be empty array [] if none
- suggestedQuestions should be empty array [] if no follow-up needed
- Be concise. Each strength/flag/question should be one short sentence.

Application data:
Name: ${app.fullName}
Country: ${app.country ?? '—'}
City: ${app.city ?? '—'}
Profession: ${app.profession ?? '—'}
Time in Istanbul: ${app.timeInCity ?? '—'}
Why are they in Istanbul: ${app.reasonHere ?? '—'}
Why do they want to join: ${app.whyJoin ?? '—'}
What they enjoy doing with others: ${app.enjoyWith ?? '—'}
What makes a good community: ${app.goodCommunity ?? '—'}
Interests: ${(app.interests ?? []).join(', ') || '—'}
How they want to contribute: ${app.contribution ?? '—'}
How they handle group conflict: ${app.groupBehavior ?? '—'}
Previously removed from a community: ${app.removedFromCommunity ?? '—'}
Past toxic behavior: ${app.toxicBehavior ?? '—'}
Bio: ${app.bio ?? '—'}
Referred by: ${app.referredBy ?? '—'}
Has Instagram: ${app.instagram ? 'yes' : 'no'}
Has LinkedIn: ${app.linkedin ? 'yes' : 'no'}`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })

    const text = completion.choices[0].message.content ?? '{}'
    const result = JSON.parse(text)

    return NextResponse.json({
      recommendation: result.recommendation ?? 'review',
      confidence:     result.confidence     ?? 50,
      summary:        result.summary        ?? '',
      strengths:      result.strengths      ?? [],
      redFlags:       result.redFlags       ?? [],
      suggestedQuestions: result.suggestedQuestions ?? [],
    })
  } catch (e) {
    console.error('OpenAI screen error', e)
    return NextResponse.json({ error: 'AI screening failed' }, { status: 500 })
  }
}
