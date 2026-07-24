import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { CATEGORIES, HANDBOOK_CATEGORIES, isKind, isValidCategory, TITLE_MAX, EXCERPT_MAX, BODY_MAX } from '@/app/admin/posts/constants'

// Match POST. External cover URLs would leak visitor IPs on render.
const COVER_PATH_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-_/]+\.(jpg|jpeg|png|webp|gif)$/i

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const post = await prisma.post.findUnique({ where: { id }, include: { author: { select: { name: true } } } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(post)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { title, excerpt, body, coverImage, status, category, kind } = await req.json()
  const existing = await prisma.post.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Kind can be edited (blog↔handbook). Fall back to existing when the body
  // omits it or sends a value outside the whitelist. Category is validated
  // against the *new* kind so a simultaneous kind+category change is coherent.
  const postKind = isKind(kind) ? kind : (existing.kind ?? 'community')
  const cleanTitle   = String(title   ?? '').trim()
  const cleanExcerpt = excerpt ? String(excerpt).trim() : ''
  const cleanBody    = String(body    ?? '').trim()
  if (!cleanTitle || !cleanBody) {
    return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
  }
  if (cleanTitle.length > TITLE_MAX)     return NextResponse.json({ error: `Title too long (max ${TITLE_MAX} chars)` }, { status: 400 })
  if (cleanExcerpt.length > EXCERPT_MAX) return NextResponse.json({ error: `Excerpt too long (max ${EXCERPT_MAX} chars)` }, { status: 400 })
  if (cleanBody.length > BODY_MAX)       return NextResponse.json({ error: `Body too long (max ${BODY_MAX} chars)` }, { status: 400 })

  // Category allowlist + cover URL validation match POST. PUT does NOT
  // touch the slug — keeping URLs stable across edits is a deliberate
  // SEO + bookmark preservation choice.
  const defaultCat    = postKind === 'handbook' ? HANDBOOK_CATEGORIES[0] : CATEGORIES[0]
  const cleanCategory = isValidCategory(postKind, category) ? String(category) : defaultCat
  const cleanCover = coverImage ? String(coverImage).trim() : ''
  if (cleanCover && !COVER_PATH_RE.test(cleanCover)) {
    return NextResponse.json({ error: 'Cover image must be uploaded via the form — external URLs are not allowed' }, { status: 400 })
  }

  const wasPublished = existing.status === 'published'
  const nowPublished = status === 'published'

  const post = await prisma.post.update({
    where: { id },
    data: {
      title:       cleanTitle,
      excerpt:     cleanExcerpt || null,
      body:        cleanBody,
      coverImage:  cleanCover || null,
      status:      nowPublished ? 'published' : 'draft',
      category:    cleanCategory,
      kind:        postKind,
      publishedAt: nowPublished
        ? (wasPublished ? existing.publishedAt : new Date())
        : null,
    },
  })

  // Audit — previously only DELETE was audited, so going draft →
  // published (the moment visibility changes) left no trail. Record
  // the specific transition so an audit reader can answer "who
  // published this and when".
  const action = !wasPublished && nowPublished ? 'post.publish'
              :  wasPublished && !nowPublished ? 'post.unpublish'
              :                                   'post.update'
  writeAudit(session.id, session.name, action, post.id, 'post',
    { title: post.title, status: post.status, category: post.category, slug: post.slug,
      wasPublished, nowPublished },
    `${action === 'post.publish' ? 'Published' : action === 'post.unpublish' ? 'Unpublished' : 'Updated'} article "${post.title}"`,
  )
  // Bust the cached public article + listing pages (unstable_cache tag)
  // so inline/admin edits show immediately instead of after the 300s TTL.
  // Handbook article/related/index caches are tagged 'handbook' separately,
  // so bust that too — otherwise handbook edits lag by up to 300s.
  revalidateTag('posts')
  revalidateTag('handbook')
  return NextResponse.json(post)
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const snapshot = await prisma.post.findUnique({ where: { id },
    select: { title: true, status: true, category: true, authorId: true, publishedAt: true } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.post.delete({ where: { id } })
  writeAudit(session.id, session.name, 'post.delete', id, 'post',
    { title: snapshot.title, status: snapshot.status, category: snapshot.category,
      authorId: snapshot.authorId, publishedAt: snapshot.publishedAt?.toISOString() ?? null },
    `Deleted ${snapshot.status} post "${snapshot.title}" (${snapshot.category})`,
  )
  revalidateTag('posts')
  revalidateTag('handbook')
  return NextResponse.json({ ok: true })
}
