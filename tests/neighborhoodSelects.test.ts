import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// The invariant: no UI surface may build a neighborhood picker from the
// hardcoded Istanbul list.
//
// Every write path validates the submitted name against the member's OWN city
// (safeNeighborhoodFor / isValidNeighborhoodFor in lib/neighborhoodsDb.ts), and
// those helpers return null rather than an error when the name isn't a
// neighborhood of that city. So a select offering Istanbul's names to a member
// anywhere else didn't fail loudly — it saved the row with the neighborhood
// silently blanked. The read path was made city-aware ahead of the write path,
// which is exactly how 22 selects across 18 files kept mapping over the
// constant after /api/neighborhoods existed to serve them.
//
// Selects must use the useCityNeighborhoods hook (or a list passed down from a
// parent that called it). lib/ may still hold the constant — Istanbul's static
// guide content is built on NEIGHBORHOOD_META — but app/ and components/ may
// not reach for it.

const ROOTS = ['app', 'components']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap(r => walk(join(process.cwd(), r)))

describe('neighborhood selects follow the viewer’s city', () => {
  it('finds source files to check (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('no file under app/ or components/ imports ISTANBUL_NEIGHBORHOODS', () => {
    const offenders = files.filter(f => {
      const src = readFileSync(f, 'utf8')
      return /^import .*\bISTANBUL_NEIGHBORHOODS\b.*$/m.test(src)
    })
    expect(offenders.map(f => f.replace(process.cwd() + '/', ''))).toEqual([])
  })

  it('no select maps over the hardcoded constant', () => {
    const offenders = files.filter(f => readFileSync(f, 'utf8').includes('ISTANBUL_NEIGHBORHOODS.map'))
    expect(offenders.map(f => f.replace(process.cwd() + '/', ''))).toEqual([])
  })
})
