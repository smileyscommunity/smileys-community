import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`ai:${session.id}`, 20, 60 * 60_000)) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  const { title, description } = await req.json()
  if (!title && !description) return NextResponse.json({ error: 'Need title or description' }, { status: 400 })

  const tagGroups = await prisma.tagGroup.findMany({
    include: { tags: { select: { id: true, name: true, emoji: true } } },
  })

  const allTags = tagGroups.flatMap(g => g.tags)
  const tagList = allTags.map(t => `${t.id}: ${t.emoji} ${t.name}`).join('\n')

  const prompt = `You are tagging a social event for Smileys community in Istanbul. Pick the most relevant tags from the list below. Choose 2–5 tags maximum. Return only a JSON array of tag IDs, nothing else.

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
