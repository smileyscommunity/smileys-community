import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { isAdmin, isModerator, isClubHost, hostCityIds } from '@/lib/access'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Bounds on what one call can put into a paid prompt.
const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Same people who may create an event (the create route's canCreate) — this
  // was open to every member, each call spending OpenAI credit.
  const canHost = isAdmin(session) || isModerator(session) || await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0
  if (!canHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await rateLimit(`ai:${session.id}`, 20, 60 * 60_000)) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  // Malformed JSON threw before any handler — a 500 for a client mistake.
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const { title: rawTitle, description: rawDescription } = body as Record<string, unknown>

  if (rawTitle !== undefined && rawTitle !== null && typeof rawTitle !== 'string') return NextResponse.json({ error: 'Title must be text' }, { status: 400 })
  if (rawDescription !== undefined && rawDescription !== null && typeof rawDescription !== 'string') return NextResponse.json({ error: 'Description must be text' }, { status: 400 })
  const title = rawTitle ?? ''
  // The event forms send the rich-text editor's HTML; tags only need the words,
  // so the cap is on the text a reader would see, not on markup.
  const description = (rawDescription ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title && !description) return NextResponse.json({ error: 'Need title or description' }, { status: 400 })
  if (title.length > MAX_TITLE) return NextResponse.json({ error: `Title must be at most ${MAX_TITLE} characters` }, { status: 400 })
  if (description.length > MAX_DESCRIPTION) return NextResponse.json({ error: `Description must be at most ${MAX_DESCRIPTION} characters` }, { status: 400 })

  const tagGroups = await prisma.tagGroup.findMany({
    include: { tags: { select: { id: true, name: true, emoji: true } } },
  })

  const allTags = tagGroups.flatMap(g => g.tags)
  const tagList = allTags.map(t => `${t.id}: ${t.emoji} ${t.name}`).join('\n')

  const prompt = `You are tagging a social event for the Smileys community. Pick the most relevant tags from the list below. Choose 2–5 tags maximum. Return only a JSON array of tag IDs, nothing else.

Available tags:
${tagList}

Event title: ${title || '—'}
Event description: ${description || '—'}

Return format: ["id1", "id2", "id3"]`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt + '\n\nRespond with: { "tagIds": ["id1", "id2"] }' }],
      temperature: 0.2,
    })

    const raw = JSON.parse(completion.choices[0].message.content ?? '{}')
    const tagIds: string[] = Array.isArray(raw.tagIds) ? raw.tagIds.filter((id: unknown) => allTags.some(t => t.id === id)) : []
    return NextResponse.json({ tagIds })
  } catch (e) {
    console.error('OpenAI suggest-tags error', e)
    return NextResponse.json({ error: 'Failed to suggest tags' }, { status: 500 })
  }
}
