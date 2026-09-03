import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { FILTER_TYPES, TYPE_ICON } from '@/lib/notificationFilters'

// A notification type in no filter bucket is invisible under every tab except
// All — `filtered` keeps only the types listed for the selected bucket. That is
// not cosmetic: on 2026-09-03 ten types and 22,699 rows were unreachable from
// any category chip, `new_article` (21,921 rows, the second most common type in
// the database) among them. Nobody noticed because All is the default.
//
// This is a ratchet, in the shape of tests/timezoneHardcoding: it reads the
// actual createNotification call sites rather than a hand-maintained list, so a
// new type added anywhere in the app fails here until it is given a bucket.

const ROOTS = ['app', 'lib', 'scripts']
const SKIP  = new Set(['node_modules', '.next', 'archive'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Types passed as a string literal to createNotification. The second argument
 * is the type; a non-literal (a variable, a ternary) is skipped rather than
 * guessed at — this is a floor on coverage, not a census.
 */
function declaredTypes(): Map<string, string> {
  const found = new Map<string, string>()
  const call  = /createNotification\(\s*[^,]+,\s*'([a-z0-9_]+)'/g
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(call)) if (!found.has(m[1])) found.set(m[1], file)
    }
  }
  return found
}

const bucketed = new Set(Object.values(FILTER_TYPES).flat())

describe('notification filter coverage', () => {
  it('finds the createNotification call sites at all', () => {
    // Guards the regex itself: if it silently matched nothing, every
    // assertion below would pass while testing exactly nothing.
    expect(declaredTypes().size).toBeGreaterThan(20)
  })

  it('every type sent anywhere in the app has a filter bucket', () => {
    const orphans = [...declaredTypes()].filter(([t]) => !bucketed.has(t))
    expect(orphans.map(([t, f]) => `${t} (${f})`)).toEqual([])
  })

  it('every type sent anywhere in the app has an icon', () => {
    // Without one the row falls back to a generic 🔔, which is how the bell
    // and the page drifted apart before they shared this module.
    const iconless = [...declaredTypes()].filter(([t]) => !TYPE_ICON[t])
    expect(iconless.map(([t, f]) => `${t} (${f})`)).toEqual([])
  })

  it('buckets are disjoint — a type in two tabs would appear twice', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const [name, types] of Object.entries(FILTER_TYPES)) {
      if (name === 'All') continue
      for (const t of types) {
        if (seen.has(t)) dupes.push(t)
        seen.add(t)
      }
    }
    expect(dupes).toEqual([])
  })
})
