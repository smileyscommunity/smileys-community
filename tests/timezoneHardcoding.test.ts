import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

// A ratchet on Türkiye-pinned time handling, the sibling of
// cityHardcoding.test.ts (read that header for the design's rationale).
//
// Every Smileys city is in Türkiye today, so a literal '+03:00' offset or
// 'Europe/Istanbul' zone gives the right answer everywhere — which is exactly
// why nothing catches a new one. The first non-Turkish city makes all of them
// wrong at once: cutoffs land an hour off, "today" flips at the wrong midnight,
// and none of it errors. lib/cityTime.ts exists so code can ask its city for
// the timezone instead of assuming Istanbul's; it is the one file allowed to
// spell the default out, and is excluded below.
//
// This locks in today's count per file:
//
//   · a NEW file with a pinned zone/offset fails
//   · an EXISTING file gaining one fails
//   · removing them passes, and you're invited to lower the number
//
// When a file reaches zero, delete its line. //-comment lines don't count —
// prose ABOUT the timezone is fine, code assuming it is not.

const PATTERNS = [/\+03:00/g, /Europe\/Istanbul/g]
const ROOTS = ['app', 'components', 'lib']
// lib/cityTime.ts owns DEFAULT_TZ — the sanctioned single spelling.
const EXCLUDED = new Set(['lib/cityTime.ts'])
const COMMENT = /^\s*(\/\/|\*|\/\*)/

// file -> how many pinned-timezone literals it had when this ratchet was set,
// 2026-08-31, while every live city still shared Türkiye's clock.
const BASELINE: Record<string, number> = {
  'app/(member)/cup/page.tsx': 7,
  'app/(member)/dashboard/page.tsx': 1,
  'app/admin/hangouts/page.tsx': 2,
  'app/admin/newsletter/page.tsx': 2,
  'app/admin/page.tsx': 1,
  'app/admin/participants/page.tsx': 1,
  'app/api/admin/events/[id]/route.ts': 1,
  'app/api/admin/mod-stats/route.ts': 1,
  'app/api/admin/surveys/route.ts': 2,
  'app/api/auth/login/route.ts': 1,
  'app/api/events/[id]/feedback/route.ts': 1,
  'app/clubs/page.tsx': 2,
  'app/guide/[slug]/EventMatches.tsx': 1,
  'app/host/events/[id]/participants/page.tsx': 1,
  'app/neighborhoods/[slug]/NeighborhoodSections.tsx': 1,
  'app/visiting/page.tsx': 2,
  'components/CityWeather.tsx': 1,
  'components/CupPromoBanner.tsx': 1,
  'lib/city.ts': 1,
  'lib/eventSeries.ts': 1,
  'lib/nps.ts': 1,
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

function countIn(file: string): number {
  let n = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (COMMENT.test(line)) continue
    for (const re of PATTERNS) n += (line.match(re) ?? []).length
  }
  return n
}

const counts = new Map<string, number>()
for (const root of ROOTS) {
  for (const abs of walk(join(process.cwd(), root))) {
    const rel = relative(process.cwd(), abs)
    if (EXCLUDED.has(rel)) continue
    const n = countIn(abs)
    if (n > 0) counts.set(rel, n)
  }
}

const ADVICE = "new Türkiye-pinned time handling — use the city's timezone via lib/cityTime helpers; this list must shrink toward zero before the first non-Turkish city"

describe('pinned-timezone literals do not spread', () => {
  it('finds files to scan (guards against a silently empty sweep)', () => {
    expect(counts.size).toBeGreaterThan(10)
  })

  it('no NEW file pins the Türkiye timezone', () => {
    const added = [...counts.keys()].filter(f => !(f in BASELINE)).sort()
    expect(added, ADVICE).toEqual([])
  })

  it('no existing file gains more', () => {
    const grown = [...counts.entries()]
      .filter(([f, n]) => f in BASELINE && n > BASELINE[f])
      .map(([f, n]) => `${f}: ${BASELINE[f]} -> ${n}`)
      .sort()
    expect(grown, ADVICE).toEqual([])
  })
})
