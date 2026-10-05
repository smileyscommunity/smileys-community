import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { reviewQueue, readingTime } from '@/lib/handbook-review'

// Handbook scan 2026-09-27, items 6–13: one rendering of the review state
// everywhere; a staff queue and an honest form for the interval; copy that
// credits the Smileys team; category and stage pages in the sitemap and the
// Handbook never capped with the stories; own photos only on category cards;
// and the small things.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('one review chip (item 6)', () => {
  it('every listing and the article render the same component, and nothing says "overdue" or hand-rolls the chip', () => {
    for (const p of ['app/handbook/page.tsx', 'app/handbook/category/[key]/page.tsx', 'app/handbook/stage/[key]/page.tsx', 'components/HandbookSearch.tsx', 'app/handbook/[slug]/EditableArticle.tsx']) {
      const src = read(p)
      expect(src, p).toContain('<ReviewChip ')
      expect(src, p).not.toContain('Review overdue')
      expect(src, p).not.toContain("'⏳' : '✓'")
    }
    expect(read('app/handbook/[slug]/EditableArticle.tsx')).toContain('showUnreviewed')
    expect(read('lib/handbook-search.ts')).toContain('reviewedStale: boolean')
    expect(read('app/handbook/page.tsx')).toContain('reviewedStale: review?.stale ?? false')
  })
  it('the chip hides a never-reviewed row in listings and says so on the article', () => {
    const src = read('components/ReviewChip.tsx')
    expect(src).toContain('if (!showUnreviewed) return null')
    expect(src).toContain('Not yet reviewed')
  })
})

describe('review queue and interval honesty (item 7)', () => {
  const day = 86_400_000
  const now = new Date('2026-09-28T12:00:00Z')
  const row = (over: Record<string, unknown>) => ({
    kind: 'handbook', status: 'published', category: 'Getting Around', lastReviewedAt: null as Date | string | null, reviewIntervalDays: null as number | null, ...over,
  })
  it('sorts published Handbook rows into overdue, never reviewed and due soon; drafts and stories stay out', () => {
    const q = reviewQueue([
      row({ slug: 'never' }),
      row({ slug: 'overdue', lastReviewedAt: new Date(now.getTime() - 100 * day) }),          // Getting Around = 90 days
      row({ slug: 'soon',    lastReviewedAt: new Date(now.getTime() - 70 * day) }),           // inside the last quarter
      row({ slug: 'fresh',   lastReviewedAt: new Date(now.getTime() - 5 * day) }),
      row({ slug: 'own-interval', lastReviewedAt: new Date(now.getTime() - 100 * day), reviewIntervalDays: 365 }),
      row({ slug: 'draft', status: 'draft' }),
      row({ slug: 'story', kind: 'community' }),
    ], now)
    expect(q.overdue.map(p => p.slug)).toEqual(['overdue'])
    expect(q.unreviewed.map(p => p.slug)).toEqual(['never'])
    expect(q.soon.map(p => p.slug)).toEqual(['soon'])
  })
  it('the admin list shows the queue and the form warns that an interval needs a first review', () => {
    const list = read('app/admin/posts/page.tsx')
    expect(list).toContain('const queue    = reviewQueue(posts)')
    expect(list).toContain('Handbook review queue')
    const form = read('app/admin/posts/PostForm.tsx')
    expect(form).toContain('{!initial.lastReviewedAt && reviewDays && (')
    expect(form).toContain('This only counts from the first review')
  })
})

describe('who wrote it (item 8)', () => {
  it('no public Handbook surface says "Member-written"', () => {
    for (const p of ['app/handbook/category/[key]/page.tsx', 'app/handbook/stage/[key]/page.tsx', 'app/[city]/moving/page.tsx']) {
      expect(read(p), p).not.toContain('Member-written')
    }
    expect(read('app/handbook/stage/[key]/page.tsx')).toContain('Written by the Smileys team, not professional advice.')
  })
})

describe('sitemap (item 10)', () => {
  const src = read('app/sitemap.ts')
  it('lists every published Handbook article and caps only the stories', () => {
    expect(src).toContain("where:   { status: 'published', kind: 'handbook', OR:")
    expect(src).toContain("where:   { status: 'published', kind: { not: 'handbook' }, OR:")
    expect(src.indexOf('take:    200,', src.indexOf("kind: { not: 'handbook' }"))).toBeGreaterThan(0)
  })
  it('lists category and stage pages per live city by the same scope and stage rules the pages use', () => {
    expect(src).toContain('`${BASE}/handbook/category/${encodeURIComponent(key)}${qs}`')
    expect(src).toContain('`${BASE}/handbook/stage/${stage.key}${qs}`')
    expect(src).toContain('populatedStages(mine, c.id)')
    expect(src).toContain('p.cityId === c.id || (p.cityId === null && (p.country === null || p.country === c.country))')
    expect(src).toContain('...handbookSectionRoutes,')
  })
})

describe('category cards and small fixes (items 11–13)', () => {
  it('category cards use an article photo or nothing, never the retired banner', () => {
    const src = read('app/handbook/category/[key]/page.tsx')
    expect(src).toContain('articleCover({ coverImage: a.coverImage, body: a.body })')
    expect(src).not.toContain('category: canonical })')
  })
  it('category dates read on the row city clock', () => {
    const src = read('app/handbook/category/[key]/page.tsx')
    expect(src).toContain('(a.cityId && tzById.get(a.cityId)) || cfg.timezone')
  })
  it('an unchanged category is kept verbatim on save', () => {
    expect(read('app/api/admin/posts/[id]/route.ts')).toContain('const cleanCategory = category === existing.category\n    ? existing.category')
  })
  it('the article closes edit mode inside the refresh transition and has no dead Next-in block', () => {
    const editor = read('app/handbook/[slug]/EditableArticle.tsx')
    expect(editor).toContain('startRefresh(() => {\n        router.refresh()')
    const page = read('app/handbook/[slug]/page.tsx')
    expect(page).not.toContain('getNextInSeries')
    expect(page).not.toContain('nextUp')
  })
  it('reading time counts hex entities as separators', () => {
    expect(readingTime('a&#x27;b '.repeat(220))).toBe(2)
    expect(readingTime('a&#39;b '.repeat(220))).toBe(2)
  })
})
