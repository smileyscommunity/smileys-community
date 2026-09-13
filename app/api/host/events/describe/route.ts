import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { isAdmin, isModerator, isClubHost, hostCityIds } from '@/lib/access'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Every call carries these into a paid prompt — bound them so 20 calls an hour
// can't each ship megabytes.
const MAX_TITLE = 200
const MAX_LOCATION = 200
const MAX_CLUB_NAME = 200
const MAX_NOTES = 2000
const MAX_VIBES = 20
const MAX_VIBE = 40

// Optional text: absent/null/'' is fine, anything else must be a string within the cap.
function optionalText(v: unknown, max: number): v is string | undefined | null {
  return v === undefined || v === null || (typeof v === 'string' && v.length <= max)
}

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
  const { title, location, vibes, clubName, notes } = body as Record<string, unknown>

  if (typeof title !== 'string' || !title.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (title.length > MAX_TITLE) return NextResponse.json({ error: `Title must be at most ${MAX_TITLE} characters` }, { status: 400 })
  if (!optionalText(location, MAX_LOCATION)) return NextResponse.json({ error: `Location must be text of at most ${MAX_LOCATION} characters` }, { status: 400 })
  if (!optionalText(clubName, MAX_CLUB_NAME)) return NextResponse.json({ error: `Club name must be text of at most ${MAX_CLUB_NAME} characters` }, { status: 400 })
  if (!optionalText(notes, MAX_NOTES)) return NextResponse.json({ error: `Notes must be text of at most ${MAX_NOTES} characters` }, { status: 400 })
  // A non-array vibes made `.join` throw outside the try → 500.
  if (vibes !== undefined && vibes !== null &&
      (!Array.isArray(vibes) || vibes.length > MAX_VIBES || !vibes.every(v => typeof v === 'string' && v.length <= MAX_VIBE))) {
    return NextResponse.json({ error: `Vibes must be a list of at most ${MAX_VIBES} short labels (${MAX_VIBE} characters each)` }, { status: 400 })
  }
  const vibeList = (vibes ?? []) as string[]

  // The generated copy is public — name the host's own city, not Istanbul.
  const host = await prisma.user.findUnique({ where: { id: session.id }, select: { city: { select: { name: true } } } })
  const cityName = host?.city.name

  const prompt = `You are writing an event description for Smileys, a curated social community${cityName ? ` in ${cityName}` : ''}. Members are international and local, English-speaking, social, and looking for genuine connection through shared experiences.

Write a compelling, warm event description in 3–4 short paragraphs (no headers, no bullet points). Use a friendly, energetic tone — not corporate, not cheesy. Mention specific details when given. End with a clear call to action like "Grab your spot" or "See you there".

Event details:
- Title: ${title}
- Venue / location: ${location || 'TBC'}
- Vibe / tags: ${vibeList.length ? vibeList.join(', ') : 'social, fun'}
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
