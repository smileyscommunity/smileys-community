import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { slugify, truncateSlug } from '@/lib/slug'
import { sanitizeArticle, isArticleImageSrc } from '@/lib/sanitize'
import { normalizeCommunityCategory, CATEGORIES, isCategory } from '@/app/admin/posts/constants'
import { storyBylines } from '@/lib/storyByline'
import { firstBodyImage } from '@/lib/articleCover'

// The Stories review (2026-09-21), server side. A member's story could not
// be published under the member's name — the edit form sent their id back
// as a "writer pick" and the route refused it as not-staff, so the only way
// through re-credited the story to staff; the handbook's sixteen articles
// rendered at a second URL under /posts; a draft's title and lede went into
// <head>; a body image could point at any host, and became the og:image;
// and a member who submitted never heard back.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('whose story it is', () => {
  const put = src('app/api/admin/posts/[id]/route.ts')

  it('sending the current author back is not a pick', () => {
    expect(put).toContain('if (authorId && authorId !== existing.authorId) {')
  })

  it('a queued story stays queued through an edit, and nothing enters the queue from here', () => {
    expect(put).toContain("const keepQueued = (status === 'submitted' || status === 'declined') && existing.status === status")
    expect(put).toContain("const nextStatus = nowPublished ? 'published' : keepQueued ? existing.status : 'draft'")
    expect(put).toContain('status:      nextStatus,')
  })

  it('the writer hears back — live, or not this time', () => {
    expect(put).toContain("createNotification(post.authorId, 'story_published', 'Your story is live',")
    expect(put).toContain('if (post.authorId !== session.id) {')
    const decline = src('app/api/admin/posts/[id]/decline/route.ts')
    expect(decline).toContain("where: { id, status: 'submitted' }, data: { status: 'declined' }")
    expect(decline).toContain("'story_declined'")
    expect(decline).toContain("'post.decline'")
  })

  it('a member can see and withdraw their own queued stories — not a draft staff are working on, never a live one', () => {
    expect(src('app/api/posts/mine/route.ts')).toContain("status: { in: ['submitted', 'declined', 'published'] }")
    const withdraw = src('app/api/posts/mine/[id]/route.ts')
    expect(withdraw).toContain("status: { in: ['submitted', 'declined'] }")
    expect(withdraw).toContain("'post.withdraw'")
  })

  it('a publish and a decline cannot both land', () => {
    expect(put).toContain('where: { id, status: existing.status },')
    expect(put).toContain("e?.code === 'P2025'")
  })

  it('leaving takes the unpublished stories along', () => {
    expect(src('app/api/auth/delete-account/route.ts')).toContain("await tx.post.deleteMany({ where: { authorId: id, status: { not: 'published' } } })")
  })
})

describe('what the public page serves', () => {
  const page = src('app/posts/[slug]/page.tsx')

  it('a live community story, or nothing — not a handbook article, not a draft', () => {
    expect(page).toContain("return !!post && post.kind === 'community' && post.status === 'published'")
    expect(page).toContain('if (!isLiveStory(post) || !post) return { robots: { index: false, follow: false } }')
    expect(page).toContain("if (!post || post.kind !== 'community') notFound()")
    expect(page).toContain('if (preview && (!session || !canManagePosts(session) || !canActOnCityContent(session, post.cityId))) notFound()')
  })

  it('related stories share the kind and the viewer\'s scope', () => {
    expect(page).toContain("where:   { kind: 'community', status: 'published', category, slug: { not: excludeSlug }, ...postCityScope(cityId, country) },")
  })

  it('the byline is projected like every other byline, and the view count is gone', () => {
    expect(page).toContain('const byline   = (await storyBylines(session, [post.author]))(post.author)')
    expect(page).not.toContain('views')
    expect(src('app/posts/page.tsx')).toContain('const byline  = await storyBylines(session, rows.map(r => r.author))')
  })

  it('a member is not asked to apply', () => {
    expect(page).toContain('{session ? (')
    expect(page).toContain('Share your story')
  })

  it('dates are the city\'s day, not the server\'s', () => {
    expect(page).toContain("timeZone })")
    expect(page).toContain('formatDate(post.publishedAt, city.timezone)')
    expect(src('app/posts/page.tsx')).toContain('formatDate(featured.publishedAt, city.timezone)')
  })

  it('the share image is one of our uploads or the brand card', () => {
    expect(page).toContain('const usable   = isArticleImageSrc(cover)')
  })
})

describe('the byline projection', () => {
  const author = { id: 'u1', name: 'Ayşe Yılmaz', color: '#123456', profilePhoto: '/app/api/files/users/a.jpg', profileVisibility: 'everyone', status: 'approved', hiddenFromMembers: false }

  it('a guest gets a first name and no photo', async () => {
    const show = await storyBylines(null, [author])
    expect(show(author)).toEqual({ name: 'Ayşe', color: '#123456', profilePhoto: null })
  })

  it('a writer no longer in good standing keeps the story but not the name', async () => {
    const show = await storyBylines(null, [author])
    expect(show({ ...author, status: 'suspended' }).name).toBe('Smileys member')
    expect(show({ ...author, hiddenFromMembers: true }).profilePhoto).toBeNull()
  })
})

describe('the body', () => {
  it('shows our own images only — an external one was a tracking pixel the cover field already refused', () => {
    expect(sanitizeArticle('<p>x</p><img src="https://evil.example/p.gif">')).not.toContain('<img')
    // …and the list cards, which read the raw body for a cover, take the
    // same answer.
    expect(firstBodyImage('<p>x</p><img src="https://evil.example/p.gif">')).toBeNull()
    expect(firstBodyImage('<img src="/app/api/files/posts/a.jpg">')).toBe('/app/api/files/posts/a.jpg')
    expect(sanitizeArticle('<img src="/app/api/files/posts/a.jpg">')).toContain('<img src="/app/api/files/posts/a.jpg"')
    expect(sanitizeArticle('<img src="/api/files/posts/a.jpg">')).toContain('<img src="/api/files/posts/a.jpg"')
    expect(isArticleImageSrc('https://smileyscommunity.com/app/api/files/posts/a.jpg')).toBe(false)
    expect(isArticleImageSrc('/app/api/files/applications/a.jpg')).toBe(false)
  })

  it('has one h1 — the title', () => {
    expect(sanitizeArticle('<h1>Section</h1>')).toBe('<h2>Section</h2>')
  })
})

describe('the submission', () => {
  const route = src('app/api/posts/submit/route.ts')

  it('is checked before it costs one of the day\'s three', () => {
    const validate = route.indexOf("if (text.length < BODY_MIN)")
    const limit    = route.indexOf('rateLimit(`story-submit:')
    expect(validate).toBeGreaterThan(0)
    expect(limit).toBeGreaterThan(validate)
  })

  it('reaches the staff who can open it', () => {
    expect(route).toContain("await notifyCityStaff(")
    expect(route).toContain("session.cityId ?? null, 'story_submission',")
    expect(route).not.toContain("role: { in: ['admin', 'moderator'] }")
  })

  it('carries no lede that would read twice', () => {
    expect(route).toContain('excerpt:  null,')
  })
})

describe('slugs', () => {
  it('keep their letters', () => {
    expect(slugify('Kadıköy, Istanbul')).toBe('kadikoy-istanbul')
    expect(slugify('Yeldeğirmeni: Istanbul\'s Brooklyn')).toBe('yeldegirmeni-istanbul-s-brooklyn')
    expect(slugify('Smileys is coming to İzmir')).toBe('smileys-is-coming-to-izmir')
    expect(slugify('თბილისი ღამით')).toBe('tbilisi ghamit'.replace(' ', '-'))
    expect(slugify('Москва зимой')).toBe('moskva-zimoy')
    expect(slugify('Café société')).toBe('cafe-societe')
    expect(slugify('Women ')).toBe('women')
  })

  it('cut on a word', () => {
    expect(truncateSlug('digital-nomad-life-the-freedom-to-go-anywhere-and-the-challenge-of-finding-somewhere', 80))
      .toBe('digital-nomad-life-the-freedom-to-go-anywhere-and-the-challenge-of-finding')
    expect(truncateSlug('short', 80)).toBe('short')
  })

  it('are minted that way on both create paths', () => {
    expect(src('app/api/posts/submit/route.ts')).toContain("const base = truncateSlug(slugify(title), 80) || 'story'")
    expect(src('app/api/admin/posts/route.ts')).toContain("const base = truncateSlug(slugify(cleanTitle), 80) || 'story'")
  })
})

describe('categories', () => {
  it('name the kind of story, and the city comes from the post', () => {
    expect(CATEGORIES).not.toContain('Istanbul Guide')
    expect(CATEGORIES).toContain('City Guide')
    // The retired names still save, as the new one.
    expect(isCategory('Istanbul Guide')).toBe(true)
    expect(normalizeCommunityCategory('Antalya Guide')).toBe('City Guide')
    expect(normalizeCommunityCategory('nonsense')).toBe('Community')
  })
})

describe('the admin list', () => {
  it('links each kind to its own page, and never to a handbook draft the page refuses', () => {
    const list = src('app/admin/posts/page.tsx')
    expect(list).toContain("href={post.kind === 'handbook' ? `/app/handbook/${post.slug}` : `/app/posts/${post.slug}`}")
    expect(list).toContain("{(post.kind !== 'handbook' || post.status === 'published') && (")
    expect(list).not.toContain("'Istanbul Guide'")
    expect(src('app/admin/posts/PostForm.tsx')).toContain(': normalizeCommunityCategory(initial.category),')
  })
})

describe('caches and the crawler', () => {
  it('a story published from "New article" is on the list at once', () => {
    const create = src('app/api/admin/posts/route.ts')
    expect(create).toContain("revalidateTag('posts')")
    expect(create).toContain("revalidateTag('explore-more')")
    expect(src('app/api/admin/posts/[id]/route.ts').match(/revalidateTag\('explore-more'\)/g)?.length).toBe(2)
  })

  it('the sitemap lists live cities\' stories, newest first', () => {
    expect(src('app/sitemap.ts')).toContain("where:   { status: 'published', OR: [{ cityId: null }, { cityId: { in: cityIds } }] },")
  })

  it('the queue and the delete have a second factor for admins', () => {
    const put = src('app/api/admin/posts/[id]/route.ts')
    expect(put).toContain('if (!wasPublished && nowPublished && isAdmin(session)) {')
    expect(put.match(/requireStepUp\(session\)/g)?.length).toBe(2)
    expect(src('app/api/admin/posts/route.ts')).toContain('if (willPublish && isAdmin(session)) {')
  })
})
