import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { firstNameOf } from '@/lib/data'
import { rateLimit } from '@/lib/rateLimit'
import { mayReengage, REENGAGE_DRAFT_LIMIT, REENGAGE_WINDOW_MS } from './gate'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await req.json().catch(() => ({}))
  if (!userId || typeof userId !== 'string') return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, interests: true, neighborhood: true, joinedAt: true, cityId: true, city: { select: { name: true } } },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Moderators draft for their own city's members only. 404 rather than 403,
  // as on the user detail route, so ids can't map which cities exist.
  if (!mayReengage(session, user.cityId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Each draft is a paid model call.
  if (!await rateLimit(`reengage-draft:${session.id}`, REENGAGE_DRAFT_LIMIT, REENGAGE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many drafts — try again in a while.' }, { status: 429 })
  }

  // The member's real situation, read here rather than trusted from the page:
  // the prompt said "hasn't attended in over 90 days" to everyone, but it
  // drafts for the Never-attended list (no event yet) and a 60-day Dormant
  // list too, so the message was false for most of the people it went to.
  const lastSeat = await prisma.eventAttendee.findFirst({
    where:   { userId, status: 'approved', attendance: { not: 'no_show' } },
    orderBy: { event: { date: 'desc' } },
    select:  { event: { select: { date: true } } },
  })
  const daysSince = (d: Date) => Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))
  const situation = lastSeat
    ? `whose last Smileys event was about ${daysSince(new Date(`${lastSeat.event.date}T12:00:00Z`))} days ago`
    : `who joined about ${Math.max(1, Math.round(daysSince(user.joinedAt) / 7))} weeks ago and hasn't been to an event yet`

  const firstName   = firstNameOf(user.name) || 'there'
  const interests   = (user.interests ?? []).slice(0, 3).join(', ')
  const neighborhood = user.neighborhood ?? null

  // The member's own city, not Istanbul — this text goes to every city's
  // lapsed members (docs/admin-panel-audit-2026-09-05.md, finding 3).
  const prompt = `You are writing a short, warm re-engagement message from the Smileys community team in ${user.city.name} to a member ${situation}.

Write 2–3 sentences max. Be warm and personal — reference their interests if available. Don't be pushy or salesy. Suggest they check out upcoming events. No exclamation marks. No "Hey" or "Hi" salutation — the platform prepends that.

Member details:
- First name: ${firstName}
- Interests: ${interests || 'not specified'}
${neighborhood ? `- Neighborhood: ${neighborhood}` : ''}

Write only the message body.`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    })

    const message = completion.choices[0].message.content?.trim() ?? ''
    return NextResponse.json({ message, firstName })
  } catch (e) {
    console.error('OpenAI reengage error', e)
    return NextResponse.json({ error: 'Failed to generate message' }, { status: 500 })
  }
}
