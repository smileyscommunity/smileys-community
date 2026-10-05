import { describe, it, expect } from 'vitest'
import {
  parseTripRange, parseTripFilters, applyTripFilters, tripFilterOptions, tripEventWhen,
  cityAvailability, isFreeEvent, type TripEvent,
} from '@/lib/tripPlan'

// The /visiting trip planner must never show the past as upcoming, and must
// never offer a filter that can't narrow anything. These pin both.

const TODAY = '2026-09-23'
const TZ = 'Europe/Istanbul'

describe('parseTripRange', () => {
  it('treats no dates as "not planning yet", not an error', () => {
    expect(parseTripRange({}, TODAY)).toEqual({ range: null, error: null, clamped: false })
  })

  it('accepts an upcoming stay as given', () => {
    expect(parseTripRange({ from: '2026-10-01', to: '2026-10-05' }, TODAY))
      .toEqual({ range: { from: '2026-10-01', to: '2026-10-05' }, error: null, clamped: false })
  })

  it('refuses a stay that has already ended', () => {
    const r = parseTripRange({ from: '2026-09-01', to: '2026-09-10' }, TODAY)
    expect(r.range).toBeNull()
    expect(r.error).toMatch(/already passed/)
  })

  it('clamps a stay that already started to today, and says so', () => {
    expect(parseTripRange({ from: '2026-09-20', to: '2026-09-26' }, TODAY))
      .toEqual({ range: { from: TODAY, to: '2026-09-26' }, error: null, clamped: true })
  })

  it('rejects half a range, reversed dates, impossible dates and over-long stays', () => {
    expect(parseTripRange({ from: '2026-10-01' }, TODAY).error).toMatch(/both/)
    expect(parseTripRange({ from: '2026-10-05', to: '2026-10-01' }, TODAY).error).toMatch(/before your arrival/)
    expect(parseTripRange({ from: '2026-02-31', to: '2026-03-02' }, TODAY).error).toMatch(/both/)
    expect(parseTripRange({ from: '2026-10-01', to: '2027-02-01' }, TODAY).error).toMatch(/up to 90 days/)
  })
})

const ev = (over: Partial<TripEvent> = {}): TripEvent => ({
  date: '2026-10-02', time: '19:00', endTime: null, neighborhood: 'Kadıköy',
  price: 0, memberPrice: null, isFirstTimerFriendly: false, language: null, ...over,
})

describe('filters', () => {
  const events = [
    ev({ neighborhood: 'Kadıköy', price: 0, isFirstTimerFriendly: true, language: 'English' }),
    ev({ neighborhood: 'Beyoğlu', price: 200, language: 'Turkish' }),
    ev({ neighborhood: 'Moda', price: 500, memberPrice: 0 }),
  ]

  it('offers only filters that would narrow the list', () => {
    expect(tripFilterOptions(events)).toEqual({
      hoods: ['Beyoğlu', 'Kadıköy', 'Moda'], free: true, first: true, langs: ['English', 'Turkish'],
    })
    // Everything free, one neighborhood, nothing first-timer, no language: nothing to offer.
    expect(tripFilterOptions([ev(), ev()])).toEqual({ hoods: [], free: false, first: false, langs: [] })
  })

  it('counts a zero member price as free, like the events feed', () => {
    expect(isFreeEvent(ev({ price: 500, memberPrice: 0 }))).toBe(true)
    expect(applyTripFilters(events, parseTripFilters({ free: '1' })).map(e => e.neighborhood)).toEqual(['Kadıköy', 'Moda'])
  })

  it('combines filters, and matches language case-insensitively', () => {
    const f = parseTripFilters({ first: '1', lang: 'english' })
    expect(applyTripFilters(events, f)).toHaveLength(1)
    expect(applyTripFilters(events, parseTripFilters({ hood: 'Beyoğlu' }))).toHaveLength(1)
    expect(applyTripFilters(events, parseTripFilters({}))).toHaveLength(3)
  })
})

describe('tripEventWhen', () => {
  // 2026-09-23 14:00 in Istanbul (UTC+3).
  const now = new Date('2026-09-23T11:00:00Z')

  it('drops past days and events already over today', () => {
    expect(tripEventWhen(ev({ date: '2026-09-22' }), TZ, TODAY, now)).toBeNull()
    expect(tripEventWhen(ev({ date: TODAY, time: '10:00', endTime: '12:00' }), TZ, TODAY, now)).toBeNull()
  })

  it('labels an event in progress, one later today, tomorrow, and later', () => {
    expect(tripEventWhen(ev({ date: TODAY, time: '13:00', endTime: '16:00' }), TZ, TODAY, now)?.kind).toBe('now')
    expect(tripEventWhen(ev({ date: TODAY, time: '19:00' }), TZ, TODAY, now)).toEqual({ kind: 'today', label: 'Today' })
    expect(tripEventWhen(ev({ date: '2026-09-24' }), TZ, TODAY, now)).toEqual({ kind: 'tomorrow', label: 'Tomorrow' })
    expect(tripEventWhen(ev({ date: '2026-10-02' }), TZ, TODAY, now)).toEqual({ kind: 'later', label: 'Fri 2 Oct' })
  })
})

describe('cityAvailability', () => {
  it('separates active, founding and coming-soon cities', () => {
    expect(cityAvailability({ status: 'live', stats: { maturity: 'self_sustaining' } })).toBe('active')
    expect(cityAvailability({ status: 'live', stats: { maturity: 'forming' } })).toBe('active')
    expect(cityAvailability({ status: 'live', stats: { maturity: 'seeding' } })).toBe('founding')
    expect(cityAvailability({ status: 'coming_soon' })).toBe('coming_soon')
    expect(cityAvailability({ status: 'preparing', stats: { maturity: 'seeding' } })).toBe('coming_soon')
  })
})

// /visiting's "Read before your trip" shelf (2026-10-02) — the visiting twin
// of the Students, Expats and Digital nomads shelves.
describe('Travelers shelf on /visiting', () => {
  it('is a category the admin form accepts', async () => {
    const { TRAVELLER_STORY_CATEGORY } = await import('@/lib/tripPlan')
    const { CATEGORIES, isCategory, normalizeCommunityCategory } = await import('@/app/admin/posts/constants')
    expect(CATEGORIES).toContain(TRAVELLER_STORY_CATEGORY)
    expect(isCategory(TRAVELLER_STORY_CATEGORY)).toBe(true)
    // City Guide rides along (Nate, 2026-10-02) — and must stay a real category.
    const { TRAVELLER_SHELF_CATEGORIES } = await import('@/lib/tripPlan')
    expect(TRAVELLER_SHELF_CATEGORIES).toEqual(['Travelers', 'City Guide', 'Travellers'])
    // The launch spelling is an alias: accepted, and saved back as 'Travelers'.
    expect(normalizeCommunityCategory('Travellers')).toBe('Travelers')
    for (const c of TRAVELLER_SHELF_CATEGORIES) expect(isCategory(c), c).toBe(true)
    expect(normalizeCommunityCategory(TRAVELLER_STORY_CATEGORY)).toBe(TRAVELLER_STORY_CATEGORY)
  })

  it('reads the visited city\'s posts only, caches no body, and busts on publish', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(join(process.cwd(), 'app/visiting/page.tsx'), 'utf8')
    const fn = page.slice(page.indexOf('const getTravellerStories'), page.indexOf("['visiting-traveler-stories']"))
    expect(fn).toMatch(/category:\s*\{ in: TRAVELLER_SHELF_CATEGORIES \},\s*cityId\s*}/)
    expect(fn).toMatch(/cover:\s*articleCover/)
    // Only rendered fields leave the cache; the body goes into articleCover only.
    expect(fn).toMatch(/rows\.map\(r => \(\{ slug: r\.slug, title: r\.title, excerpt: r\.excerpt, cover: articleCover/)
    expect(page).toMatch(/\['visiting-traveler-stories'\],\s*\{[^}]*tags:\s*\['posts'\]/)
    for (const f of ['app/posts/page.tsx', 'app/posts/[slug]/page.tsx', 'app/admin/posts/page.tsx']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).toMatch(/'Travelers':\s*'bg-/)
    }
  })

})

// /visiting order (Nate, 2026-10-02: events don't lead). Read from the parsed
// page, not from string positions: a botched move once left three sections
// nested INSIDE the stories cards while every indexOf still came out in order.
describe('/visiting section order', () => {
  async function topLevel() {
    const ts = (await import('typescript')).default
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(process.cwd(), 'app/visiting/page.tsx')
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let fn: import('typescript').FunctionDeclaration | undefined
    ;(function walk(n: import('typescript').Node) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'VisitingPage') fn = n; n.forEachChild(walk) })(sf)
    const rets: import('typescript').ReturnStatement[] = []
    ;(function walk(n: import('typescript').Node) {
      if (n !== fn && (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))) return
      if (ts.isReturnStatement(n)) rets.push(n)
      n.forEachChild(walk)
    })(fn!.body!)
    let e = rets[rets.length - 1].expression!
    while (ts.isParenthesizedExpression(e)) e = e.expression
    if (!ts.isJsxElement(e)) throw new Error('VisitingPage no longer returns a single element')
    return e.children.map(c => c.getText()).filter(t => t.trim() && !/^\{\s*\/\*[\s\S]*\*\/\s*\}$/.test(t))
  }

  it('no block holds more than one section (nothing nested inside another)', async () => {
    for (const t of await topLevel()) expect((t.match(/<section/g) ?? []).length, t.slice(0, 80)).toBeLessThanOrEqual(1)
  })

  // Three acts, in the order a trip happens (Nate, 2026-10-02): Before you
  // go (essentials, stories, where to stay) → When you're here (first 48
  // hours, sights, trip types) → Meet people (events during your stay, who's
  // coming, tell the community). Events never lead.
  it('reads as a trip: before you go, when you are here, meet people', async () => {
    const blocks = await topLevel()
    const at = (id: string) => blocks.findIndex(t => t.includes(`aria-labelledby="${id}"`) || t.includes(`<section id="${id}"`))
    // Meet people opens with the visit panel (Nate, 2026-10-02: it was buried
    // ~6,000px down), then who's coming, then the events.
    const order = ['essentials-title', 'stories-title', 'stay', 'first-48-title', 'interests-title', 'tell-title', 'plan-title', 'where-title'].map(at)
    expect(order.every(i => i > -1), JSON.stringify(order)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('each act is labeled, and Plan my visit lands on Before you go', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(join(process.cwd(), 'app/visiting/page.tsx'), 'utf8')
    for (const label of ["actLabel('Before you go')", "actLabel('When you’re here')", "actLabel('Meet people')"]) expect(page).toContain(label)
    expect(page.match(/href="#before-you-go"/g)).toHaveLength(2)   // hero + final CTA
    expect(page).not.toContain('href="#plan" className="btn-')
  })
})


describe('/visiting before dates are entered', () => {
  it('shows a three-card taster and a link to the calendar, not six cards', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(join(process.cwd(), 'app/visiting/page.tsx'), 'utf8')
    expect(page).toContain('const PREVIEW_SHOWN  = 3')
    expect(page).toContain('timedEvents.slice(0, PREVIEW_SHOWN)')
    expect(page).not.toContain('timedEvents.slice(0, 6)')
    expect(page).toContain('See everything on in {city.name} →')
  })

  it('the visit panel leads Meet people, says what the button does, and keeps every rule', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(join(process.cwd(), 'app/visiting/page.tsx'), 'utf8')
    const tell = page.slice(page.indexOf('<section id="tell"'), page.indexOf('</section>', page.indexOf('<section id="tell"')))
    expect(tell).toContain("{actLabel('Meet people')}")
    expect(tell).toContain('Apply to join — free, then post your visit')
    for (const term of ['You need a Smileys account', 'Who sees your visit', 'What to expect', 'Staying safe']) expect(tell, term).toContain(term)
    expect(tell).toContain('some from nobody')   // the honest line stays
    expect(page.match(/actLabel\('Meet people'\)/g)).toHaveLength(1)
  })
})

