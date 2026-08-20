import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Switching city on the dashboard kept showing the previous city's events.
// The page resolves a cityId and used it for some queries — polls, the
// founding-member panel, neighborhood picks — but seven event queries and
// three member queries ran network-wide: featured events, spots running low,
// new-in-your-clubs, this week's events, the events-this-week and
// events-this-month counts, the neighborhood event count, total members, new
// members, and suggested members.
//
// The neighborhood count was the quietest of them: neighborhood NAMES repeat
// across cities, so it counted another city's events for a same-named area
// and looked plausible while being wrong.
//
// A source guard, like cityHardcoding and navLinks: the page is a ~2000-line
// server component doing 40+ Prisma queries, and standing it up in a test
// would mock so much that it proved nothing. What this asserts is narrow and
// exactly the thing that broke — a discovery query that forgot the city.

const SRC = readFileSync(join(process.cwd(), 'app/(member)/dashboard/page.tsx'), 'utf8')
const LINES = SRC.split('\n')

/**
 * Each community query paired with its OWN where clause.
 *
 * Brace-matched, not a fixed window of following lines: a window bleeds into
 * the next query, so a one-line `count({ where: { … } })` that had lost its
 * cityId still "passed" because a neighbouring query further down had one.
 * That version of this guard failed to catch a deliberately reintroduced bug,
 * which is the only test result that matters when writing a guard.
 */
function communityQueries(): { line: number; text: string; where: string }[] {
  const out: { line: number; text: string; where: string }[] = []
  const re = /prisma\.(event|user)\.(findMany|count|findFirst)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(SRC))) {
    const start = m.index
    const whereAt = SRC.indexOf('where:', start)
    if (whereAt === -1) continue
    const open = SRC.indexOf('{', whereAt)
    // A where can also be a bare identifier (`where: suggestedMembersWhere,`)
    // — cut at the comma, or the next `{` belongs to `select` and the whole
    // rest of the query gets treated as the clause.
    const identifier = SRC.slice(whereAt + 6, open === -1 ? undefined : open).split(',')[0]
    if (!/^\s*$/.test(identifier)) {
      out.push({ line: SRC.slice(0, start).split('\n').length, text: SRC.slice(start, start + 70).split('\n')[0].trim(), where: identifier.trim() })
      continue
    }
    let depth = 0, i = open
    for (; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++
      else if (SRC[i] === '}') { depth--; if (depth === 0) break }
    }
    out.push({
      line: SRC.slice(0, start).split('\n').length,
      text: SRC.slice(start, start + 70).split('\n')[0].trim(),
      where: SRC.slice(open, i + 1),
    })
  }
  return out
}

describe('dashboard is scoped to the city being viewed', () => {
  it('finds the queries at all — the guard is worthless if the shape drifted', () => {
    expect(communityQueries().length).toBeGreaterThan(8)
  })

  it('every event/member discovery query carries cityId in its OWN where clause', () => {
    const unscoped = communityQueries()
      // Built above the query rather than inline; carries cityId at its
      // definition, asserted separately below.
      .filter(q => q.where !== 'suggestedMembersWhere')
      .filter(q => !q.where.includes('cityId'))
      .map(q => `line ${q.line}: ${q.text}`)

    expect(unscoped, 'these dashboard queries would show another city\'s content').toEqual([])
  })

  it('builds suggested members from the viewed city too', () => {
    const where = SRC.split('const suggestedMembersWhere')[1]?.split('})()')[0] ?? ''
    expect(where).not.toBe('')
    expect(where).toContain('cityId')
  })

  it('still resolves the city from the session/view cookie rather than assuming one', () => {
    expect(SRC).toMatch(/const cityId = await resolveCityId\(session\)/)
  })

  it('counts events in the viewer\'s neighborhood within the city, since names repeat across cities', () => {
    const seg = SRC.split('neighborhood: userProfile.neighborhood')[1]?.slice(0, 200) ?? ''
    const decl = SRC.split('neighborhood: userProfile.neighborhood')[0].slice(-200)
    expect(decl + seg).toContain('cityId')
  })
})
