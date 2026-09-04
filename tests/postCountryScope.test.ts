import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import { postCityScope, postCityScopeSql } from '@/lib/postScope'

// Handbook articles come in three scopes and the schema could only say two.
//
// "cityId null = show everywhere" was correct for as long as every Smileys
// city was in Türkiye, because every national article (residence permit,
// Turkish bank account, SIM card) happened to be true in every city. The
// first non-Turkish city makes all four wrong at once, with no error: a
// member in Athens is recommended the Turkish residence-permit guide.
//
// lib/postScope is the one definition of who sees what. These tests pin
// its shape, act it out against rows the way the database would, and — the
// part that keeps it honest — refuse any read path that spells the old
// two-way rule by hand instead of importing it.

// Evaluate a Prisma-shaped where against a row, for exactly the operators
// postCityScope emits: a top-level OR of ANDed equality clauses. Small on
// purpose; it exists so the scope can be tested as behaviour, not as text.
type Row = { cityId: string | null; country: string | null }
function matches(row: Row, where: { OR: Partial<Row>[] }): boolean {
  return where.OR.some(clause =>
    (Object.keys(clause) as (keyof Row)[]).every(k => row[k] === clause[k]),
  )
}

const istanbulCity   = { cityId: 'ist', country: null }   // İstanbulkart
const ankaraCity     = { cityId: 'ank', country: null }   // Başkentkart
const turkishNational = { cityId: null, country: 'TR' }   // residence permit
const genuinelyGlobal = { cityId: null, country: null }   // most community posts

describe('postCityScope — who sees which article', () => {
  it('a Turkish city sees its own, the national ones, and the global ones', () => {
    const w = postCityScope('ank', 'TR')
    expect(matches(ankaraCity,      w)).toBe(true)
    expect(matches(turkishNational, w)).toBe(true)
    expect(matches(genuinelyGlobal, w)).toBe(true)
    expect(matches(istanbulCity,    w)).toBe(false)
  })

  it('a city outside Türkiye is NOT handed the Turkish national articles', () => {
    // The bug this whole change exists for. Athens: cityId 'ath', country 'GR'.
    const w = postCityScope('ath', 'GR')
    expect(matches(turkishNational, w)).toBe(false)
    expect(matches(genuinelyGlobal, w)).toBe(true)
    expect(matches(ankaraCity,      w)).toBe(false)
  })

  it('a city with no country on record still sees the global ones and nothing national', () => {
    const w = postCityScope('x', null)
    expect(matches(genuinelyGlobal, w)).toBe(true)
    expect(matches(turkishNational, w)).toBe(false)
  })

  it('the SQL spelling binds the same two values in the same shape', () => {
    // Prisma.Sql keeps text and values apart; the rule is the text, and the
    // values are the only two things a caller can vary.
    const sql = postCityScopeSql('ank', 'TR')
    expect(sql.values).toEqual(['ank', 'TR'])
    const text = sql.strings.join('?').replace(/\s+/g, ' ')
    expect(text).toContain('"cityId" = ?')
    expect(text).toContain('"cityId" IS NULL AND ("country" IS NULL OR "country" = ?)')
  })
})

// ── The ratchet ────────────────────────────────────────────────────────────
// Every read path once carried its own copy of the two-way rule. Six copies of
// one clause drift, and a seventh caller written from memory would reintroduce
// the bug with no error. So: no post query outside lib/postScope may spell the
// city rule by hand, in Prisma or in SQL.
const ROOTS    = ['app', 'lib', 'components']
const EXCLUDED = new Set(['lib/postScope.ts'])
const HAND_ROLLED = [
  /OR:\s*\[\s*\{\s*cityId(?::\s*\w+)?\s*\}\s*,\s*\{\s*cityId:\s*null\s*\}\s*\]/,   // OR: [{ cityId }, { cityId: null }]
  /OR:\s*\[\s*\{\s*cityId:\s*null\s*\}\s*,\s*\{\s*cityId(?::\s*\w+)?\s*\}\s*\]/,   // OR: [{ cityId: null }, { cityId }]
  /"cityId"\s+IS\s+NULL\s+OR\s+"cityId"\s*=/i,                                     // raw SQL
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

describe('no read path spells the post city rule by hand', () => {
  it('every post query goes through lib/postScope', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const abs of walk(join(process.cwd(), root))) {
        const rel = relative(process.cwd(), abs)
        if (EXCLUDED.has(rel)) continue
        const lines = readFileSync(abs, 'utf8').split('\n')
        // Per query, not per file: clubs and partners keep their own two-way
        // rule and share files with post queries. An OR is a post's when a
        // prisma.post call (or FROM posts) opened within the previous few
        // lines and the clause isn't nested under a relation like club: { … }.
        for (let i = 0; i < lines.length; i++) {
          if (!HAND_ROLLED.some(re => re.test(lines[i]))) continue
          if (/\b(club|partner|business|listing):\s*\{/.test(lines[i])) continue
          const window = lines.slice(Math.max(0, i - 8), i + 1).join('\n')
          if (/prisma\.post\b|FROM posts\b/.test(window)) offenders.push(`${rel}:${i + 1}`)
        }
      }
    }
    expect(offenders, `hand-rolled city scope on a post query — import postCityScope from lib/postScope instead:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
