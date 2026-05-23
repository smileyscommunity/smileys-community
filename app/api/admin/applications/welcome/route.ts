import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canReviewApplications } from '@/lib/access'

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
    select: { fullName: true, interests: true, contribution: true, reasonHere: true, profession: true },
  })

  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const firstName = app.fullName?.split(' ')[0] ?? app.fullName ?? 'there'
  const interests = (app.interests ?? []).slice(0, 3).join(', ')
  const contributionLabel = app.contribution === 'host' ? 'wants to host events'
    : app.contribution === 'organize' ? 'wants to help organize'
    : 'is joining as an attendee'

  const prompt = `You are writing a warm, personal welcome message on behalf of the Smileys community team in Istanbul. Smileys is a curated social community — international, English-speaking, genuine, and energetic.

Write a short welcome message (3–5 sentences) to send to a newly approved member. Be warm and specific — reference their interests or background. Do NOT be corporate or generic. Do NOT use exclamation marks more than once. End with a specific next step (check the events page, join the WhatsApp group, etc.).

Member details:
- First name: ${firstName}
- Interests: ${interests || 'not specified'}
- Plans to: ${contributionLabel}
${app.reasonHere ? `- Reason in Istanbul: ${app.reasonHere}` : ''}
${app.profession ? `- Profession: ${app.profession}` : ''}

Write only the message body. No subject line, no signature, no "Hi" salutation (the platform adds that).`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    })

    const message = completion.choices[0].message.content?.trim() ?? ''
    return NextResponse.json({ message })
  } catch (e) {
    console.error('OpenAI welcome error', e)
    return NextResponse.json({ error: 'Failed to generate welcome message' }, { status: 500 })
  }
}
