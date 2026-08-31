import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { slugify } from '@/lib/slug'

export const dynamic = 'force-dynamic'

// Member story submission (/share-story). Lands as status 'submitted' — a
// third Post status that no public read matches (they all filter on
// 'published'), so nothing is visible until an admin reviews it in
// /admin/posts and publishes. The member stays the author: a published
// story carries their real byline on /posts, which is the entire point —
// the Stories sections should speak in members' voices, not the admin's.
const TITLE_MAX = 120
const BODY_MIN  = 100
const BODY_MAX  = 10_000

// Members write plain text. Escape it and shape paragraphs here, once, so
// the stored body renders exactly like an admin-authored article and the
// reviewer edits real markup rather than a wall of text.
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/\n{2,}/)
    .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`story-submit:${session.id}`, 3, 24 * 60 * 60_000)) {
      return NextResponse.json({ error: 'You can submit up to 3 stories a day' }, { status: 429 })
    }

    const body  = await req.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const text  = typeof body?.body  === 'string' ? body.body.trim()  : ''
    if (!title)                  return NextResponse.json({ error: 'Give your story a title' }, { status: 400 })
    if (title.length > TITLE_MAX) return NextResponse.json({ error: `Keep the title under ${TITLE_MAX} characters` }, { status: 400 })
    if (text.length < BODY_MIN)  return NextResponse.json({ error: 'Tell us a bit more — a few paragraphs at least' }, { status: 400 })
    if (text.length > BODY_MAX)  return NextResponse.json({ error: `Keep it under ${BODY_MAX.toLocaleString('en-US')} characters` }, { status: 400 })

    // Same collision loop as the admin create route: slug is permanent once
    // published, so it's minted at submission and never touched again.
    const base = slugify(title).slice(0, 80) || 'story'
    let slug = base
    for (let i = 1; await prisma.post.findUnique({ where: { slug }, select: { id: true } }); i++) {
      slug = `${base}-${i}`
    }

    const firstPara = text.split(/\n{2,}/)[0].replace(/\n/g, ' ').trim()
    const post = await prisma.post.create({
      data: {
        title,
        slug,
        body:     textToHtml(text),
        excerpt:  firstPara.length > 200 ? `${firstPara.slice(0, 197)}…` : firstPara,
        kind:     'community',
        category: 'Community',
        status:   'submitted',
        authorId: session.id,
        // The writer's own city by default — their story is about their
        // Smileys. The reviewer flips it to "every city" when it reads
        // network-wide.
        cityId:   session.cityId ?? null,
      },
      select: { id: true },
    })

    const admins = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { id: true } })
    await Promise.all(admins.map(a => createNotification(
      a.id, 'story_submission',
      'New member story',
      `${session.name} submitted "${title}" for review`,
      '/admin/posts',
    ))).catch(e => console.error('Story admin notify failed:', e))

    return NextResponse.json({ ok: true, id: post.id })
  } catch (e) {
    console.error('Story submit error:', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
