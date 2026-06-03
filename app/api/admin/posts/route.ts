import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts } from '@/lib/access'
import { slugify } from '@/lib/slug'
import { writeAudit } from '@/lib/audit'
import { CATEGORIES, isCategory, TITLE_MAX, EXCERPT_MAX, BODY_MAX } from '@/app/admin/posts/constants'

// Cover image must be a local upload path (the shape /api/upload
// returns). External URLs in cover-image fields render as <img src>
// on public pages, leaking visitor IPs / referers to a third party.
const COVER_PATH_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-_/]+\.(jpg|jpeg|png|webp|gif)$/i

export async function GET() {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const posts = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { name: true } } },
  })
  return NextResponse.json(posts)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, excerpt, body, coverImage, status, category } = await req.json()
  const cleanTitle   = String(title   ?? '').trim()
  const cleanExcerpt = excerpt ? String(excerpt).trim() : ''
  const cleanBody    = String(body    ?? '').trim()
  if (!cleanTitle || !cleanBody) {
    return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
  }
  if (cleanTitle.length > TITLE_MAX)     return NextResponse.json({ error: `Title too long (max ${TITLE_MAX} chars)` }, { status: 400 })
  if (cleanExcerpt.length > EXCERPT_MAX) return NextResponse.json({ error: `Excerpt too long (max ${EXCERPT_MAX} chars)` }, { status: 400 })
  if (cleanBody.length > BODY_MAX)       return NextResponse.json({ error: `Body too long (max ${BODY_MAX} chars)` }, { status: 400 })

  // Category allowlist — previously accepted ANY string.
  const cleanCategory = isCategory(category) ? category : CATEGORIES[0]

  // Reject external cover image URLs — they would render as <img src>
  // on the public posts page, leaking visitor IPs / referers to a
  // third party. Empty string is allowed (no cover).
  const cleanCover = coverImage ? String(coverImage).trim() : ''
  if (cleanCover && !COVER_PATH_RE.test(cleanCover)) {
    return NextResponse.json({ error: 'Cover image must be uploaded via the form — external URLs are not allowed' }, { status: 400 })
  }

  const base = slugify(cleanTitle).slice(0, 80)
  let slug = base
  let i = 1
  while (await prisma.post.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`
  }

  const willPublish = status === 'published'
  const post = await prisma.post.create({
    data: {
      title:       cleanTitle,
      slug,
      excerpt:     cleanExcerpt || null,
      body:        cleanBody,
      coverImage:  cleanCover || null,
      status:      willPublish ? 'published' : 'draft',
      category:    cleanCategory,
      authorId:    session.id,
      publishedAt: willPublish ? new Date() : null,
    },
  })

  writeAudit(session.id, session.name, willPublish ? 'post.publish' : 'post.create',
    post.id, 'post',
    { title: post.title, status: post.status, category: post.category, slug: post.slug },
    `${willPublish ? 'Published' : 'Drafted'} article "${post.title}" (${post.category})`,
  )
  return NextResponse.json(post)
}
