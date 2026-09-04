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
// It reached zero on 2026-09-04 (32 literals in 21 files, cleared for the
// first non-Turkish city). From here the rule is simply: none, anywhere
// but lib/cityTime.ts. The per-file baseline mechanism stays so an argued
// exception can be recorded with a number rather than by deleting the test:
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
  // Emptied 2026-09-04: every pinned zone outside lib/cityTime.ts is gone.
  // A new entry here is a deliberate, argued exception — not a default.
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

let scanned = 0
const counts = new Map<string, number>()
for (const root of ROOTS) {
  for (const abs of walk(join(process.cwd(), root))) {
    scanned++
    const rel = relative(process.cwd(), abs)
    if (EXCLUDED.has(rel)) continue
    const n = countIn(abs)
    if (n > 0) counts.set(rel, n)
  }
}

const ADVICE = "new Türkiye-pinned time handling — use the city's timezone via lib/cityTime helpers; this list must shrink toward zero before the first non-Turkish city"

describe('pinned-timezone literals do not spread', () => {
  it('finds files to scan (guards against a silently empty sweep)', () => {
    // Files walked, not files with hits — with the baseline at zero the
    // second is meant to be empty; it is the walk that must not be.
    expect(scanned).toBeGreaterThan(200)
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
