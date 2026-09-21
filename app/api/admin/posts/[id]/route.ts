import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { pickWriter } from '@/lib/postWriter'
import { toCountryCode } from '@/lib/country'
import { getSession } from '@/lib/session'
import { canManagePosts, canActOnCityContent, isAdmin } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { writeAudit } from '@/lib/audit'
import { notifyNewArticle, createNotification } from '@/lib/notify'
import { parseHandbookFields } from '@/lib/handbook-review'
import { isKind, normalizeCommunityCategory, normalizeHandbookCategory, TITLE_MAX, EXCERPT_MAX, BODY_MAX } from '@/app/admin/posts/constants'

// Match POST. External cover URLs would leak visitor IPs on render.
const COVER_PATH_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-_/]+\.(jpg|jpeg|png|webp|gif)$/i

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const post = await prisma.post.findUnique({ where: { id }, include: { author: { select: { name: true } } } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActOnCityContent(session, post.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(post)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const payload = await req.json()
  const { title, excerpt, body, coverImage, status, category, kind, cityId, country, authorId } = payload
  const existing = await prisma.post.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActOnCityContent(session, existing.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Kind can be edited (blog↔handbook). Fall back to existing when the body
  // omits it or sends a value outside the whitelist. Category is validated
  // against the *new* kind so a simultaneous kind+category change is coherent.
  const postKind = isKind(kind) ? kind : (existing.kind ?? 'community')
  // Handbook-only fields, patched only for the keys the client sent (the
  // inline editor sends none and must leave them alone).
  const handbook = postKind === 'handbook' ? parseHandbookFields(payload) : { ok: true as const, data: {} }
  if (!handbook.ok) return NextResponse.json({ error: handbook.error }, { status: 400 })
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
  // See POST: both vocabularies normalise (handbook → canonical IA key,
  // retired per-city guide names → 'City Guide').
  const cleanCategory = postKind === 'handbook' ? normalizeHandbookCategory(category) : normalizeCommunityCategory(category)
  const cleanCover = coverImage ? String(coverImage).trim() : ''
  if (cleanCover && !COVER_PATH_RE.test(cleanCover)) {
    return NextResponse.json({ error: 'Cover image must be uploaded via the form — external URLs are not allowed' }, { status: 400 })
  }

  const wasPublished = existing.status === 'published'
  const nowPublished = status === 'published'
  // A member story sits in the queue as 'submitted' (or 'declined' once
  // answered). Saving an edit used to coerce either to 'draft', which took
  // it off the Submitted tab and relabelled it as staff's own draft. The
  // client sends the status back unchanged; it is honoured only when it IS
  // the current one — nothing can be put into the queue from here.
  const keepQueued = (status === 'submitted' || status === 'declined') && existing.status === status
  const nextStatus = nowPublished ? 'published' : keepQueued ? existing.status : 'draft'
  // Publishing bells a city (or everyone): step-up for admins, as on the
  // broadcast route; a moderator's publish stays on the capability check.
  if (!wasPublished && nowPublished && isAdmin(session)) {
    const gate = requireStepUp(session)
    if (gate) return gate
  }

  // Only touch cityId when the client sent the key, so a partial edit can't
  // silently globalize a city-pinned post. '' / null = global; a real id is
  // validated so it can't orphan the post.
  // A post is city-local, national, or global (see lib/postScope). `country`
  // only means anything on a post with no city, so pinning a city clears it —
  // a stale country under a cityId is dead data that reads like a rule.
  let cityPatch: { cityId?: string | null; country?: string | null } = {}
  if (country !== undefined) {
    const code = country === null || country === '' ? null : toCountryCode(country)
    if (country && !code) return NextResponse.json({ error: 'Country must be a 2-letter ISO code' }, { status: 400 })
    cityPatch = { country: code }
  }
  if (cityId !== undefined) {
    if (cityId) {
      const c = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } })
      if (!c) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
      cityPatch = { ...cityPatch, cityId: c.id, country: null }
    } else {
      cityPatch = { ...cityPatch, cityId: null }
    }
    // Re-pinning is a move; the destination must be the moderator's too.
    if (!canActOnCityContent(session, cityPatch.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only touch the writer when the client sent one (an admin's pick); a
  // partial edit must not re-credit an article to whoever saved it.
  // The same author sent back is not a pick. The edit form round-trips the
  // row, and for a member-submitted story that is the MEMBER's id — which
  // pickWriter refused (not staff), so the story could only be published by
  // re-crediting it to a staff writer. The byline the member was promised.
  let writerPatch: { authorId?: string } = {}
  if (authorId && authorId !== existing.authorId) {
    const writer = await pickWriter(session, authorId)
    if (!writer.ok) return NextResponse.json({ error: writer.error }, { status: writer.status })
    writerPatch = { authorId: writer.id }
  }

  // Guarded on the status we read: a decline landing between the read and
  // this write would otherwise be overwritten, and the writer told "not this
  // time" and "it's live" a second apart.
  const post = await prisma.post.update({
    where: { id, status: existing.status },
    data: {
      ...cityPatch,
      ...writerPatch,
      title:       cleanTitle,
      excerpt:     cleanExcerpt || null,
      body:        cleanBody,
      coverImage:  cleanCover || null,
      status:      nextStatus,
      category:    cleanCategory,
      kind:        postKind,
      publishedAt: nowPublished
        ? (wasPublished ? existing.publishedAt : new Date())
        : null,
      ...handbook.data,
    },
  }).catch((e: { code?: string }) => { if (e?.code === 'P2025') return null; throw e })
  if (!post) {
    return NextResponse.json({ error: 'This article changed while you were editing — reload and try again' }, { status: 409 })
  }

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
  revalidateTag('explore-more')
  // Notify the membership only on the draft→published transition — never on
  // edits of an already-live article (would re-ping on every typo fix).
  // Fire-and-forget so the ~1k-member fan-out never blocks the save.
  if (action === 'post.publish') {
    notifyNewArticle(post).catch(err => console.error('notifyNewArticle failed:', err))
    // The broadcast skips the author on purpose; the writer of a member
    // story is the one person who most wants to know it went up.
    if (post.authorId !== session.id) {
      createNotification(post.authorId, 'story_published', 'Your story is live',
        `"${post.title}" is up in Stories, under your name.`, `/posts/${post.slug}`)
        .catch(err => console.error('story_published notify failed:', err))
    }
  }
  return NextResponse.json(post)
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const snapshot = await prisma.post.findUnique({ where: { id },
    select: { title: true, status: true, category: true, authorId: true, publishedAt: true, cityId: true } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActOnCityContent(session, snapshot.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Destructive: step-up for admins (moderators would be refused outright).
  if (isAdmin(session)) {
    const gate = requireStepUp(session)
    if (gate) return gate
  }
  await prisma.post.delete({ where: { id } })
  // cityId from the snapshot: the post is gone, so the audit lookup can't find it.
  writeAudit(session.id, session.name, 'post.delete', id, 'post',
    { title: snapshot.title, status: snapshot.status, category: snapshot.category,
      authorId: snapshot.authorId, publishedAt: snapshot.publishedAt?.toISOString() ?? null, cityId: snapshot.cityId },
    `Deleted ${snapshot.status} post "${snapshot.title}" (${snapshot.category})`,
  )
  revalidateTag('posts')
  revalidateTag('handbook')
  revalidateTag('explore-more')
  return NextResponse.json({ ok: true })
}
