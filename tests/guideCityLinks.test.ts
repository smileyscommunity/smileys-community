import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Guide scan 2026-09-27, items 1–8: an admin save must not drop the seeded
// link fields; an unpublished default-city entry must go offline; every
// link out of a guide page must carry its city; hidden members stay out of
// counts and tips; search must fold Turkish.

vi.mock('@/lib/prisma', () => ({ prisma: {
  guideEntry: { findMany: vi.fn(), count: vi.fn() },
  city:       { findFirst: vi.fn() },
} }))
vi.mock('@/lib/city', () => ({
  DEFAULT_CITY_SLUG: 'istanbul',
  getDefaultCityId:  vi.fn(async () => 'c-istanbul'),
  getCityConfig:     vi.fn(async () => ({ slug: 'istanbul', name: 'Istanbul', timezone: 'Europe/Istanbul' })),
  getCityTz:         vi.fn(async () => 'Europe/Istanbul'),
}))

import { prisma } from '@/lib/prisma'
import { guideEntryPayload, CARRIED_CONTENT_KEYS, type GuideEntryValue } from '@/lib/guideEntryInput'
import { getExperienceAnyCity, getRouteAnyCity, guideCityQs } from '@/lib/guideContent'
import { experienceMatchesQuery } from '@/lib/guide'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const value: GuideEntryValue = {
  slug: 'ferry-at-sunset', title: 'Take the Ferry at Sunset', emoji: '⛴️', tagline: 'One of the simplest ways.',
  collection: 'bosphorus', moods: ['bosphorus'], seasons: [], cost: 'Free-ish', time: '1–2 hours', when: '',
  neighborhoods: ['Karaköy'], firstTime: true, why: 'Because.', take: 'Take a regular ferry.',
  sections: [{ title: 'Best routes', items: ['Kadıköy → Beşiktaş'] }], photo: null, status: 'published', sortOrder: 1,
}

describe('guideEntryPayload (item 1)', () => {
  it('carries the seeded Handbook / Directory / Club links through an edit the editor cannot see', () => {
    const existing = {
      why: 'old', take: 'old', sections: [], photo: null,
      handbook: [{ slug: 'istanbulkart-mastery', label: 'Using the İstanbulkart' }],
      directory: { label: 'Ferry piers', href: '/directory?category=transport' },
      clubs: ['sailing-club'],
    }
    const content = guideEntryPayload(value, existing).content as Record<string, unknown>
    expect(content.handbook).toEqual(existing.handbook)
    expect(content.directory).toEqual(existing.directory)
    expect(content.clubs).toEqual(existing.clubs)
    // The editable fields still come from the form, never from the old row.
    expect(content.why).toBe('Because.')
    expect(content.take).toBe('Take a regular ferry.')
    expect(CARRIED_CONTENT_KEYS).toEqual(['handbook', 'directory', 'clubs'])
  })
  it('a create (no existing row) and a row without links both produce plain content', () => {
    expect(Object.keys(guideEntryPayload(value).content)).toEqual(['why', 'take', 'sections', 'photo'])
    expect(Object.keys(guideEntryPayload(value, { why: 'x' }).content)).toEqual(['why', 'take', 'sections', 'photo'])
    expect(Object.keys(guideEntryPayload(value, null).content)).toEqual(['why', 'take', 'sections', 'photo'])
  })
  it('the admin PATCH passes the existing content', () => {
    expect(read('app/api/admin/guide-entries/[id]/route.ts')).toContain('guideEntryPayload(check.value, existing.content)')
  })
})

describe('by-slug resolvers (item 2)', () => {
  // The has-rows answer is memoised for 60s per (city, kind); step the clock
  // past it between cases so each one asks the (mocked) database afresh.
  let clock = Date.now()
  beforeEach(() => {
    vi.mocked(prisma.guideEntry.findMany).mockReset()
    vi.mocked(prisma.guideEntry.count).mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    clock += 120_000
    vi.setSystemTime(clock)
  })
  it('an unpublished default-city experience is gone, not served from the shipped JSON', async () => {
    vi.mocked(prisma.guideEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.guideEntry.count).mockResolvedValue(15)
    expect(await getExperienceAnyCity('turkish-hammam')).toBeUndefined()
    expect(await getRouteAnyCity('half-day-kadikoy')).toBeUndefined()
  })
  it('an EMPTY table still falls back to the shipped default-city content', async () => {
    vi.mocked(prisma.guideEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.guideEntry.count).mockResolvedValue(0)
    const exp = await getExperienceAnyCity('turkish-breakfast')
    expect(exp?.experience.slug).toBe('turkish-breakfast')
    expect(exp?.citySlug).toBe('istanbul')
  })
})

describe('guideCityQs (items 3–4)', () => {
  it('is empty for the default city and ?city= for every other', () => {
    expect(guideCityQs('istanbul')).toBe('')
    expect(guideCityQs('izmir')).toBe('?city=izmir')
  })
  it('the index keeps the city on the audience filter and "Show everything"', () => {
    const src = read('app/guide/page.tsx')
    expect(src).toContain('const cityQs = guideCityQs(city.slug)')
    expect(src).toContain('href={`/guide${cityQs}#experiences`}')
    expect(src).toContain('guideHref(`for=${a.value}`)')
    expect(src).not.toContain("'/guide#experiences'")
    expect(src).not.toContain('`/guide?for=${a.value}#experiences`')
  })
  it('the experience page carries the city on back, neighbourhoods, events and apply', () => {
    const src = read('app/guide/[slug]/page.tsx')
    expect(src).toContain('href={`/guide${qs}`}')
    expect(src).toContain('href={`/neighborhoods/${r.slug}${qs}`}')
    expect(src).toContain('href={`/events${qs}`}')
    expect(src).toContain('applyHref={`/apply${qs}`}')
    expect(src).not.toContain('href="/guide"')
    expect(src).not.toContain('href="/events"')
  })
  it('the route page carries the city on back and along-the-way', () => {
    const src = read('app/guide/routes/[slug]/page.tsx')
    expect(src).toContain('href={`/guide${qs}`}')
    expect(src).toContain('href={`/neighborhoods/${r.slug}${qs}`}')
    expect(src).not.toContain('href="/guide"')
  })
  it('the islands take the apply link from the page rather than hard-coding /apply', () => {
    expect(read('app/guide/[slug]/ExperienceActions.tsx')).not.toContain('href="/apply"')
    expect(read('app/guide/[slug]/TipsBlock.tsx')).not.toContain('href="/apply"')
  })
})

describe('LiveHangouts (item 5)', () => {
  it("asks the API for the CONTENT's city and renders times in its zone", () => {
    const src = read('app/guide/[slug]/LiveHangouts.tsx')
    expect(src).toContain('/app/api/hangouts?city=${encodeURIComponent(citySlug)}')
    expect(src).not.toContain('useCurrentCity')
    expect(read('app/guide/[slug]/page.tsx')).toContain('<LiveHangouts neighborhoods={nearby} citySlug={citySlug} timezone={cityCfg.timezone} />')
  })
})

describe('experienceMatchesQuery (item 6)', () => {
  const moods = [{ value: 'night-out', label: 'Go Out Tonight', emoji: '🍸' }]
  const exp = { title: 'Graze Through Kadıköy Market', tagline: 'İzmir-style counters', why: '', take: '', moods: ['night-out'] }
  it('folds Turkish letters on both sides', () => {
    expect(experienceMatchesQuery(exp, 'kadikoy', moods)).toBe(true)
    expect(experienceMatchesQuery(exp, 'izmir', moods)).toBe(true)
    expect(experienceMatchesQuery(exp, 'KADIKÖY', moods)).toBe(true)
  })
  it('searches mood labels, not only their ids', () => {
    expect(experienceMatchesQuery(exp, 'go out tonight', moods)).toBe(true)
    expect(experienceMatchesQuery(exp, 'hammam', moods)).toBe(false)
  })
})

describe('hidden members (items 7–8)', () => {
  it('the guide member counts use the same two filters as /neighborhoods', () => {
    expect(read('app/guide/page.tsx')).toContain('cityId, neighborhoodVisible: true, hiddenFromMembers: false }')
  })
  it('tips hide admin-hidden authors and blocked pairs; likes only land on visible tips', () => {
    const tips = read('app/api/guide/[slug]/tips/route.ts')
    expect(tips).toContain("user: { status: 'approved', hiddenFromMembers: false }")
    expect(tips).toContain('blockedPairIds(session?.id ?? null)')
    expect(tips).toContain('userId: { notIn: blocked }')
    expect(read('app/api/guide/tips/[tipId]/like/route.ts')).toContain("user: { status: 'approved', hiddenFromMembers: false }")
  })
})
