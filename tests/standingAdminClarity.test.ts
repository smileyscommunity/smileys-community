import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// An empty queue and a broken one looked identical: three of the four tabs
// render nothing most days, under the words "Nothing here." Meanwhile the
// overview stats were fetched, assigned, and never drawn — every number that
// would answer "is this working?" was already on the wire, unused.

const src = (p: string) => readFileSync(p, 'utf-8')

describe('the standing page explains an empty queue', () => {
  const page = src('app/admin/standing/page.tsx')

  it('no longer shrugs', () => {
    expect(page).not.toContain("'Nothing here.'")
    expect(page).toContain('<EmptyQueue view={view} stats={s} />')
  })

  it('names the threshold that would fill the cards queue, from the constants', () => {
    expect(page).toContain('YELLOW_AFTER_OFFENCES as YELLOW_AT')
    expect(page).toContain('STANDING_WINDOW_DAYS as STANDING_WINDOW')
    // The copy interpolates them rather than hard-coding "two" and "90".
    expect(page).toMatch(/\$\{YELLOW_AT\}[^`]*\$\{STANDING_WINDOW\}/)
  })

  it('draws the stats it already fetched', () => {
    for (const k of ['s.offences30', 's.counting30', 's.liveYellow', 's.liveRed', 's.disputed']) {
      expect(page).toContain(k)
    }
  })
})

describe('the disputes badge', () => {
  it('counts disputes only — a card is a record, a dispute is someone waiting', () => {
    const route = src('app/api/admin/mod-stats/route.ts')
    expect(route).toContain('standingOffence.count')
    expect(route).toContain('status: OffenceStatus.Disputed')
    // Scoped like every other moderator count.
    expect(route).toContain("isAdmin(session) ? {} : { user: { cityId: failClosedCityId(session) } }")
  })

  it('is wired to the Standing nav item', () => {
    expect(src('components/admin/Sidebar.tsx')).toContain("href.startsWith('/admin/standing')")
  })

  it('survives a response from an older deployment', () => {
    // parseModCounts must not reject a body missing the new field, or the
    // whole sidebar loses its badges mid-deploy.
    const lib = src('lib/modCounts.ts')
    expect(lib).toContain('standingDisputes: n(b.standingDisputes) ?? 0')
  })
})

describe('the counts are the navigation', () => {
  const page = src('app/admin/standing/page.tsx')

  it('every queue is reachable from its own tile', () => {
    for (const v of ['disputes', 'review', 'cards', 'offences']) {
      expect(page).toContain(`onClick={() => setView('${v}')}`)
    }
  })

  it('a tile with somewhere to go is a button, and says which queue is open', () => {
    expect(page).toContain('<button type="button" onClick={onClick} aria-pressed={!!active}')
    // A tile without an onClick stays a plain div — no fake affordance.
    expect(page).toContain("if (!onClick) return")
  })

  it('drops the duplicate tab row wherever the tiles render', () => {
    // A count per queue AND a tab per queue was the same four things twice.
    expect(page).toContain('{!s && (')
  })

  it('keeps the plain row for moderators, who get no counts', () => {
    // The stats are network-wide and admin-only (enforcement route), so a
    // moderator with no tiles must still be able to change queue.
    expect(src('app/api/admin/standing/enforcement/route.ts'))
      .toContain('if (!isAdmin(session)) return NextResponse.json(await standingEnforcement())')
    expect(page).toContain('VIEWS.map(v => (')
  })
})
