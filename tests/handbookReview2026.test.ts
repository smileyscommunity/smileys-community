import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseOfficialSources, officialSourceError, parseHandbookFields, normalizeTags, SOURCES_SHOWN } from '@/lib/handbook-review'
import { seeAlsoSlug } from '@/lib/handbookSeeAlso'

// The Handbook review (2026-09-22). The index and category cards still took
// any host for a card cover (the leak the Stories fix closed the day
// before); dates were the server's UTC day and flipped on hydration; the
// review lifecycle had no staff path — "Last reviewed" could only move via a
// server script; a malformed source URL 500'd the article; a byline was the
// author's full name for guests; Tbilisi's empty handbook promised
// Istanbul's topics.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('card covers', () => {
  it('come from the one helper that refuses an external image, on every list', () => {
    expect(src('app/handbook/page.tsx')).toContain("import { articleCover } from '@/lib/articleCover'")
    expect(src('app/handbook/page.tsx')).not.toContain('FIRST_BODY_IMG_RE')
    expect(src('app/handbook/category/[key]/page.tsx')).toContain('const cover = articleCover({ coverImage: a.coverImage, body: a.body, category: canonical })')
    expect(src('app/handbook/category/[key]/page.tsx')).not.toMatch(/a\.body\.match\(/)
  })

  it('and the share image is one of our uploads or the title card', () => {
    expect(src('app/handbook/[slug]/page.tsx')).toContain('if (isArticleImageSrc(coverImage)) return `${SITE_URL}${resolveImageUrl(coverImage as string)}?w=1200`')
  })
})

describe('dates', () => {
  it("are the city's day, formatted once on the server", () => {
    const page = src('app/handbook/[slug]/page.tsx')
    expect(page).toContain("timeZone: articleCity.timezone })}`")
    expect(page).toContain('publishedText={publishedText}')
    const editable = src('app/handbook/[slug]/EditableArticle.tsx')
    expect(editable).not.toContain('toLocaleDateString')
    expect(editable).not.toContain('rawBody')
    // The view count is back by request (2026-09-22) — as a settled number
    // from the server, never computed in this client component.
    expect(src('app/handbook/[slug]/page.tsx')).toContain("const fresh     = await prisma.post.findUnique({ where: { id: post.id }, select: { views: true } })")
    expect(editable).toContain('👁 ${props.views.toLocaleString')
    expect(src('app/handbook/category/[key]/page.tsx')).toContain('formatDate(a.publishedAt, cfg.timezone)')
  })
})

describe('the review lifecycle', () => {
  it('has a staff path: "Reviewed today" on the article, nothing else moves lastReviewedAt', () => {
    const route = src('app/api/admin/posts/[id]/reviewed/route.ts')
    expect(route).toContain("data: { lastReviewedAt: now }")
    expect(route).toContain("'post.reviewed'")
    expect(route).toContain("revalidateTag('handbook')")
    // The form never carries it.
    expect(src('app/admin/posts/PostForm.tsx')).not.toMatch(/lastReviewedAt:\s/)
    expect(src('app/api/admin/posts/[id]/route.ts')).not.toContain('lastReviewedAt:')
    expect(src('app/api/admin/posts/route.ts')).not.toContain('lastReviewedAt:')
  })

  it('the other three fields are validated on both write paths, handbook only', () => {
    expect(src('app/api/admin/posts/route.ts')).toContain("const handbook = cleanKind === 'handbook' ? parseHandbookFields(payload) : { ok: true as const, data: {} }")
    expect(src('app/api/admin/posts/[id]/route.ts')).toContain("const handbook = postKind === 'handbook' ? parseHandbookFields(payload) : { ok: true as const, data: {} }")
    expect(parseHandbookFields({ reviewIntervalDays: 0 }).ok).toBe(false)
    expect(parseHandbookFields({ reviewIntervalDays: '' })).toEqual({ ok: true, data: { reviewIntervalDays: null } })
    expect(parseHandbookFields({ reviewIntervalDays: 90, tags: ['ikamet', ' ikamet ', 'e-devlet'] }))
      .toEqual({ ok: true, data: { reviewIntervalDays: 90, tags: ['ikamet', 'e-devlet'] } })
    expect(parseHandbookFields({ officialSources: [{ label: 'Göç İdaresi', url: 'https://e-ikamet.goc.gov.tr/' }] }))
      .toEqual({ ok: true, data: { officialSources: [{ label: 'Göç İdaresi', url: 'https://e-ikamet.goc.gov.tr/' }] } })
    expect(parseHandbookFields({ officialSources: [{ label: 'x', url: 'http://example.com' }] }).ok).toBe(false)
    // A partial edit leaves what it did not send alone.
    expect(parseHandbookFields({ title: 'x' })).toEqual({ ok: true, data: {} })
    expect(normalizeTags(new Array(11).fill('t').map((t, i) => t + i))).toBeNull()
    // A body that is not an object patches nothing rather than throwing.
    expect(parseHandbookFields('abc')).toEqual({ ok: true, data: {} })
    expect(parseHandbookFields(null)).toEqual({ ok: true, data: {} })
    expect(parseHandbookFields({ reviewIntervalDays: true }).ok).toBe(false)
    expect(parseHandbookFields({ reviewIntervalDays: [90] }).ok).toBe(false)
    // A tag with a comma would come back as two through the form's one field.
    expect(normalizeTags(['a,b'])).toBeNull()
    // The same link twice is one source — two would be a duplicate React key.
    expect(parseHandbookFields({ officialSources: [
      { label: 'a', url: 'https://a.b/c' }, { label: 'b', url: 'https://a.b/c' },
    ] })).toEqual({ ok: true, data: { officialSources: [{ label: 'a', url: 'https://a.b/c' }] } })
    expect(parseOfficialSources([{ label: 'a', url: 'https://a.b/c' }, { label: 'b', url: 'https://a.b/c' }])).toHaveLength(1)
    expect(officialSourceError({ label: 'x', url: `https://a.b/${'x'.repeat(2100)}` })).toMatch(/too long/)
  })

  it('an overdue review is amber on the index too, in one calendar', () => {
    const index = src('app/handbook/page.tsx')
    expect(index).toContain("staleBySlug.get(a.slug) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'")
    // A review is a staff act: the card, the article chip and the search
    // result all read it in the default city's day, or two of them disagree
    // by a day for a city off Istanbul's offset.
    expect(index).toContain('timeZone: DEFAULT_TZ })')
  })
})

describe('official sources', () => {
  it('parse for real — a bad address is dropped, not thrown at render', () => {
    expect(parseOfficialSources([{ label: 'a', url: 'https://' }, { label: 'b', url: 'https://foo bar' }, { label: 'ok', url: 'https://www.goc.gov.tr/x' }]))
      .toEqual([{ label: 'ok', url: 'https://www.goc.gov.tr/x', host: 'goc.gov.tr' }])
    expect(parseOfficialSources([{ label: 'http', url: 'http://goc.gov.tr' }])).toEqual([])
    expect(officialSourceError({ label: 'x', url: 'https://' })).toMatch(/not a valid address/)
    expect(officialSourceError({ label: '', url: 'https://a.b' })).toMatch(/needs a label/)
    expect(officialSourceError({ label: 'x', url: 'https://a.b/c' })).toBeNull()
    // The page uses the parsed host, never new URL() in the render.
    expect(src('app/handbook/[slug]/page.tsx')).not.toContain('new URL(s.url)')
  })

  it('show a few and fold the rest', () => {
    expect(SOURCES_SHOWN).toBe(6)
    const page = src('app/handbook/[slug]/page.tsx')
    expect(page).toContain('const shownSources  = sources.slice(0, SOURCES_SHOWN)')
    expect(page).toContain('more source{foldedSources.length === 1')
  })
})

describe('the article page', () => {
  const page = src('app/handbook/[slug]/page.tsx')

  it('projects the byline for the viewer, in the page and in the JSON-LD', () => {
    expect(page).toContain('const byline = (await storyBylines(session, [post.author]))(post.author)')
    expect(page).toContain("author:            { '@type': 'Person', name: byline.name },")
    expect(page).not.toContain('post.author.name')
  })

  it('renders an unpublished article for the staff who can act on it, and no one else', () => {
    expect(page).toContain("if (!post || post.kind !== 'handbook') notFound()")
    expect(page).toContain('if (preview && (!session || !canManagePosts(session) || !canActOnCityContent(session, post.cityId))) notFound()')
    expect(page).toContain("return { title: 'Handbook — Smileys Community', robots: { index: false, follow: false } }")
  })

  it('names the article that overlaps it', () => {
    expect(seeAlsoSlug('istanbul-residence-permit-guide')).toBe('residence-permit-first-application')
    expect(seeAlsoSlug('opening-turkish-bank-account')).toBe('istanbul-bank-account-guide')
    expect(seeAlsoSlug('istanbulkart-mastery')).toBeNull()
    expect(page).toContain("where:  { slug, kind: 'handbook', status: 'published' },")
  })

  it('promises nothing it does not have', () => {
    expect(page).not.toContain('Q&A is coming')
    expect(page).toContain("{session && (")
    const index = src('app/handbook/page.tsx')
    expect(index).not.toContain('Contributor badge')
    expect(index).not.toContain('first 20 essential articles')
    expect(index).toContain('The {city.name} Handbook starts with its first article')
    // …and the other cities' description names no topics they may not have.
    expect(index).toContain('`Understand ${name}. Practical answers for living, moving and navigating life in ${name} — written by Smileys members who actually lived it.`')
  })
})

describe('the rest', () => {
  it('the Explore tile hides an empty handbook, like the guide and stories tiles', () => {
    const em = src('components/ExploreMore.tsx')
    expect(em).toContain("prisma.post.count({ where: { kind: 'handbook',  status: 'published', ...postCityScope(cityId, country) } }),")
    expect(em).toContain("show: counts.handbook > 0 }")
  })

  it('a like race is not a 500', () => {
    const like = src('app/api/handbook/[slug]/like/route.ts')
    expect(like).toContain("if ((e as { code?: string })?.code !== 'P2002') throw e")
    expect(like).toContain('const gone = await prisma.postLike.deleteMany({ where: { postId: post.id, userId: session.id } })')
  })

  it('a stray percent in the category key is a 404, not a 500', () => {
    const cat = src('app/handbook/category/[key]/page.tsx')
    expect(cat).toContain('try { return decodeURIComponent(param) } catch { return param }')
    expect(cat).not.toMatch(/categoryMeta\(decodeURIComponent/)
  })

  it('moderators see the Edit button only where the save would succeed', () => {
    expect(src('app/api/auth/me/route.ts')).toContain('cityId: true,')
    // A moderator with no home city can act on nothing (canActInCity fails
    // closed), so `d.cityId == null` must not pass here either.
    expect(src('app/handbook/[slug]/EditableArticle.tsx'))
      .toContain("(d.role === 'moderator' && props.cityId !== null && d.cityId === props.cityId)")
  })

  it('the cards carry the same byline as the article', () => {
    expect(src('app/handbook/page.tsx')).toContain('const byline   = await storyBylines(await getSession(), articles.map(a => a.author))')
    expect(src('app/handbook/category/[key]/page.tsx')).toContain('const byline   = await storyBylines(session, articles.map(a => a.author))')
    for (const f of ['app/handbook/page.tsx', 'app/handbook/category/[key]/page.tsx']) {
      expect(src(f)).not.toContain('firstNameOf(a.author.name)')
    }
  })

  it('the tip link reaches a form that knows what it is about', () => {
    expect(src('app/handbook/[slug]/page.tsx')).toContain('/contact?topic=handbook&article=${encodeURIComponent(post.slug)}')
    const contact = src('app/contact/page.tsx')
    expect(contact).toContain("const topic   = params.get('topic')")
    expect(contact).toContain("TOPICS.some(t => t.value === topic)")
    expect(src('app/api/contact/route.ts')).toContain("handbook:    'Handbook article',")
  })
})
