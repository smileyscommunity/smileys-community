import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`ai:${session.id}`, 20, 60 * 60_000)) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  const { title, location, vibes, clubName, notes } = await req.json()
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const prompt = `You are writing an event description for Smileys, a curated social community in Istanbul. Members are international and local, English-speaking, social, and looking for genuine connection through shared experiences.

Write a compelling, warm event description in 3–4 short paragraphs (no headers, no bullet points). Use a friendly, energetic tone — not corporate, not cheesy. Mention specific details when given. End with a clear call to action like "Grab your spot" or "See you there".

Event details:
- Title: ${title}
- Venue / location: ${location || 'TBC'}
- Vibe / tags: ${vibes?.length ? vibes.join(', ') : 'social, fun'}
${clubName ? `- Hosted by: ${clubName} club` : ''}
${notes ? `- Extra context from the host: ${notes}` : ''}

Write only the description text. No subject line, no title, no labels.`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    })

    const description = completion.choices[0].message.content?.trim() ?? ''
    return NextResponse.json({ description })
  } catch (e) {
    console.error('OpenAI describe error', e)
    return NextResponse.json({ error: 'Failed to generate description' }, { status: 500 })
  }
}
