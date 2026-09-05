import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageUsers } from '@/lib/access'
import { firstNameOf } from '@/lib/data'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageUsers(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, interests: true, neighborhood: true, joinedAt: true, city: { select: { name: true } } },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const firstName   = firstNameOf(user.name) || 'there'
  const interests   = (user.interests ?? []).slice(0, 3).join(', ')
  const neighborhood = user.neighborhood ?? null

  // The member's own city, not Istanbul — this text goes to every city's
  // lapsed members (docs/admin-panel-audit-2026-09-05.md, finding 3).
  const prompt = `You are writing a short, warm re-engagement message from the Smileys community team in ${user.city.name} to a member who hasn't attended an event in over 90 days.

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
