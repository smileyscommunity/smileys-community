import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { experienceSearchText, searchTextMatches, guideReviewLine, SEASON_VALUES } from '@/lib/guide'
import { headlineFor, computeTodayPicks, EVENING_LATE_HOUR } from '@/lib/guideToday'

// Guide scan 2026-09-27, items 9–16: the seasons shelf shows each entry once;
// a reviewed date is earned, shown, and honest when absent; copy that promised
// company or sunsets it could not deliver; the explorer ships cards, not the
// full text; and nothing claims an ISR window that never engaged.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('seasons shelf (item 9)', () => {
  it('places an entry once, under the first of its seasons, and skips all-year tags', () => {
    const src = read('app/guide/page.tsx')
    expect(src).toContain('placed.has(e.slug)')
    expect(src).toContain('tagged.length >= SEASON_VALUES.length')
    expect(src).toContain('if (placed.size < 2) return null')
    expect(SEASON_VALUES).toHaveLength(4)
  })
})

describe('reviewed date (item 10)', () => {
  it('shows a date only when one was earned, formatted on the default-city calendar', () => {
    expect(guideReviewLine(null)).toBeNull()
    expect(guideReviewLine(undefined)).toBeNull()
    expect(guideReviewLine('not a date')).toBeNull()
    expect(guideReviewLine('2026-03-12T10:00:00Z')).toBe('Checked by Smileys · 12 March 2026')
    // 23:30 UTC is already the next day in Istanbul.
    expect(guideReviewLine('2026-03-12T23:30:00Z')).toBe('Checked by Smileys · 13 March 2026')
  })
  it('the detail page says so out loud when nobody has checked an entry', () => {
    const src = read('app/guide/[slug]/page.tsx')
    expect(src).toContain('guideReviewLine(exp.lastReviewedAt)')
    expect(src).toContain('Not yet checked by the Smileys team')
  })
  it('the only writer is the reviewed route, by raw SQL so updatedAt stays put; the editor has the button', () => {
    const route = read('app/api/admin/guide-entries/[id]/reviewed/route.ts')
    expect(route).toContain('UPDATE "guide_entries" SET "lastReviewedAt"')
    expect(route).toContain('requireStepUp(session)')
    expect(read('lib/guideEntryInput.ts')).not.toContain('lastReviewedAt')
    const editor = read('app/admin/guide-entries/page.tsx')
    expect(editor).toContain('/reviewed`, { method: \'POST\'')
    expect(editor).toContain('Never reviewed — readers see no date')
    expect(read('lib/guideContent.ts')).toContain('lastReviewedAt: r.lastReviewedAt instanceof Date')
  })
})

describe('honest copy (items 11–12, 14)', () => {
  it('"Do it with people" only promises company it can show', () => {
    const src = read('app/guide/[slug]/page.tsx')
    expect(src).toContain('const hasCompany = matchedEvents.length > 0 || matchedClubs.length > 0')
    expect(src).not.toContain('does things like this every week')
  })
  it('the neighborhoods header counts the cards shown and claims "Live" only with events to sort by', () => {
    const src = read('app/guide/page.tsx')
    expect(src).toContain('const shownNeighborhoods = neighborhoods.slice(0, SHOWN)')
    expect(src).toContain('{shownNeighborhoods.length} {shownNeighborhoods.length === 1')
    expect(src).toContain("{withEvents.length > 0 && <>Sorted by upcoming events ·{' '}</>}")
  })
  it('plurals and empty pills', () => {
    const actions = read('app/guide/[slug]/ExperienceActions.tsx')
    expect(actions).toContain("member{count === 1 ? '' : 's'}")
    expect(actions).not.toContain('{count} Smileys')
    const detail = read('app/guide/[slug]/page.tsx')
    expect(detail).toContain("member{c.memberCount === 1 ? '' : 's'}")
    expect(detail).toContain('[exp.cost, exp.time, exp.when].filter(Boolean)')
    expect(read('app/guide/ExperienceExplorer.tsx')).toContain('[e.cost, e.time].filter(Boolean)')
    const route = read('app/guide/routes/[slug]/page.tsx')
    expect(route).toContain("Route{route.time ? ` · ${route.time}` : ''}")
    expect(route).toContain('findIndex(s => s.experience === stop.experience) === i')
  })
  it('the evening headline stops promising a sunset once it has set', () => {
    expect(headlineFor('evening', 17).title('Izmir')).toBe('Sunset is coming')
    expect(headlineFor('evening', EVENING_LATE_HOUR).title('Izmir')).toBe('Izmir this evening')
    expect(headlineFor('night', 23).title('Izmir')).toBe('Izmir after dark')
    const picks = computeTodayPicks([], { citySlug: 'bodrum', timezone: 'Europe/Istanbul', available: [] })
    expect(picks.hour).toBeGreaterThanOrEqual(0)
    expect(picks.hour).toBeLessThan(24)
  })
})

describe('index apply link (item 13)', () => {
  it('the community CTA applies to the city being read', () => {
    expect(read('app/guide/page.tsx')).toContain('<GuideCTA cityName={city.name} citySlug={city.slug} applyHref={`/apply${cityQs}`} />')
    expect(read('app/guide/GuideCTA.tsx')).not.toContain('href="/apply"')
  })
})

describe('explorer payload (item 15)', () => {
  it('search runs on a pre-folded string the server builds once', () => {
    const moods = [{ value: 'night-out', label: 'Go Out Tonight', emoji: '🍸' }]
    const text = experienceSearchText({ title: 'Kadıköy Market', tagline: '', why: 'İzmir', take: '', moods: ['night-out'] }, moods)
    expect(text).toContain('kadikoymarket')
    expect(searchTextMatches(text, 'izmir')).toBe(true)
    expect(searchTextMatches(text, 'go out tonight')).toBe(true)
    expect(searchTextMatches(text, '')).toBe(true)
    expect(searchTextMatches(text, 'hammam')).toBe(false)
  })
  it('the index hands the explorer cards, never the full entries', () => {
    const src = read('app/guide/page.tsx')
    expect(src).toContain('search: experienceSearchText(e, moods)')
    expect(src).not.toContain('experiences={experiences}\n')
    const explorer = read('app/guide/ExperienceExplorer.tsx')
    expect(explorer).toContain('experiences: ExplorerCard[]')
    expect(explorer).not.toContain('e.why')
  })
})

describe('rendering premise (item 16)', () => {
  it('no guide route exports a revalidate window or static params it cannot honor', () => {
    for (const p of ['app/guide/page.tsx', 'app/guide/[slug]/page.tsx', 'app/guide/routes/[slug]/page.tsx']) {
      const src = read(p)
      expect(src, p).not.toMatch(/export const revalidate/)
      expect(src, p).not.toContain('generateStaticParams')
      expect(src, p).not.toMatch(/ISR-cached|ISR window/)
    }
  })
  it('the islands take their data from the server render instead of fetching it after hydration', () => {
    const actions = read('app/guide/[slug]/ExperienceActions.tsx')
    expect(actions).toContain('initial: Initial')
    expect(actions).not.toContain('useEffect')
    const tips = read('app/guide/[slug]/TipsBlock.tsx')
    expect(tips).toContain('initialTips: Tip[]')
    expect(tips).not.toContain('fetch(`/app/api/guide/${slug}/tips`, { credentials: \'include\' })\n      .then')
    const page = read('app/guide/[slug]/page.tsx')
    expect(page).toContain('guideViewerState(exp.slug, cityId, session)')
    expect(page).toContain('listGuideTips(exp.slug, cityId, session)')
    // The routes and the page read through one module, so they cannot drift.
    expect(read('app/api/guide/[slug]/route.ts')).toContain('guideViewerState(slug, cityId')
    expect(read('app/api/guide/[slug]/tips/route.ts')).toContain('listGuideTips(slug, owner.cityId, session)')
  })
})
