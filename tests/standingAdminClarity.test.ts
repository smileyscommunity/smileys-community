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

describe('a tile counts exactly what its queue returns', () => {
  const page  = src('app/admin/standing/page.tsx')
  const stats = src('app/api/admin/standing/enforcement/route.ts')
  const queue = src('app/api/admin/standing/route.ts')

  it('counts shadow cards, because the card queues do not filter them out', () => {
    // While enforcement is off EVERY card is shadow. Excluding them made all
    // three card tiles read 0 in front of a full list — during exactly the
    // period an admin reads this page to decide whether to switch on.
    expect(stats).toContain('prisma.standingCard.count({ where: { level: CardLevel.Yellow, status: { in: LIVE_CARD_STATUSES } } })')
    expect(stats).toContain('prisma.standingCard.count({ where: { level: CardLevel.Red,    status: { in: LIVE_CARD_STATUSES } } })')
    expect(queue).not.toContain('shadow: false')
    // ...and the split is named on the tile rather than hidden.
    expect(page).toContain('${s.shadowLive} shadow')
  })

  it('opens a 30-day list under a 30-day count', () => {
    expect(queue).toContain("recordedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }")
    // A dispute is never date-filtered: somebody is waiting on it.
    expect(queue).toContain("? { status: OffenceStatus.Disputed, ...cityScope }")
  })

  it('says when a queue is only its first page', () => {
    expect(queue).toContain('const total = await prisma.standingOffence.count({ where })')
    expect(queue).toContain('const total = await prisma.standingCard.count({ where })')
    expect(page).toContain('Showing the first {items.length} of {total}')
  })

  it('does not call someone with a card "one short of the first yellow"', () => {
    // Their next offence escalates an existing card; it is not a first yellow.
    expect(stats).toContain("distinct: ['userId']")
    expect(stats).toContain('!carded.has(g.userId)')
  })
})
