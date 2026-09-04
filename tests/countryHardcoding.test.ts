import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

// A ratchet on the founding country, the sibling of cityHardcoding and
// timezoneHardcoding. Three things were spelled as if every city were in
// Türkiye: the lira sign on every admin revenue figure, 'TRY' as the fallback
// currency in a dozen places, and '+90' in every phone placeholder. Each was
// right for six cities and wrong for the seventh, with no error.
//
// Money is spelled once, in lib/data.ts (DEFAULT_CURRENCY, currencySymbol,
// formatMoney); dial codes once, in lib/country.ts. Everything else asks its
// city. So: zero of each, anywhere but there.
//
// The country's NAME is different: "Turkish male quota" is a real feature
// (a nationality-based sub-cap on Istanbul events), a nationality list has
// to say Turkey, and the About page tells a New York story. Those get a
// per-file baseline, locked at today's count — a new file naming the country,
// or an existing one naming it more, has to be a deliberate act. When a file
// reaches zero, delete its line.

const ROOTS   = ['app', 'components', 'lib']
const COMMENT = /^\s*(\/\/|\*|\/\*)/

// Where each thing is allowed to be spelled.
const MONEY_HOME = new Set(['lib/data.ts', 'app/api/admin/settings/route.ts'])  // formatter; the admin symbol whitelist
const DIAL_HOME  = new Set(['lib/country.ts'])

const LIRA_SIGN  = /\u20ba/
const TRY_CODE   = /['"]TRY['"]/
const DIAL_90    = /\+90\b/
const COUNTRY    = /Türkiye|Turkey|Turkish|\bTürk\b/

// file -> how many country-name lines it had on 2026-09-04.
const COUNTRY_BASELINE: Record<string, number> = {
  'app/(member)/cup/page.tsx': 1,
  'app/(member)/directory/submit/page.tsx': 1,
  'app/about/page.tsx': 1,
  'app/admin/clubs/page.tsx': 1,
  'app/admin/directory/page.tsx': 2,
  'app/admin/events/[id]/edit/page.tsx': 2,
  'app/admin/events/[id]/participants/page.tsx': 3,
  'app/admin/events/new/page.tsx': 3,
  'app/api/admin/clubs/seed-regional/route.ts': 4,
  'app/api/admin/events/[id]/participants/route.ts': 4,
  'app/api/events/[id]/rsvp/route.ts': 6,
  'app/events/[id]/page.tsx': 1,
  'app/privacy/page.tsx': 1,
  'app/why/page.tsx': 1,
  'components/DirectoryOwnerEdit.tsx': 1,
  'lib/countries.ts': 1,
  'lib/cup-data.ts': 1,
  'lib/data.ts': 3,
  'lib/eventQuota.ts': 3,
  'lib/profileOptions.ts': 1,
  'lib/regionalClubSeeding.ts': 6,
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

type Hit = { file: string; line: number; text: string }
const lira: Hit[] = [], code: Hit[] = [], dial: Hit[] = []
const countryCounts = new Map<string, number>()
let scanned = 0
for (const root of ROOTS) {
  for (const abs of walk(join(process.cwd(), root))) {
    scanned++
    const rel = relative(process.cwd(), abs)
    readFileSync(abs, 'utf8').split('\n').forEach((text, i) => {
      if (COMMENT.test(text)) return
      const hit = { file: rel, line: i + 1, text: text.trim().slice(0, 90) }
      if (!MONEY_HOME.has(rel) && LIRA_SIGN.test(text)) lira.push(hit)
      if (!MONEY_HOME.has(rel) && TRY_CODE.test(text))  code.push(hit)
      if (!DIAL_HOME.has(rel)  && DIAL_90.test(text))   dial.push(hit)
      if (COUNTRY.test(text)) countryCounts.set(rel, (countryCounts.get(rel) ?? 0) + 1)
    })
  }
}
const show = (hits: Hit[]) => hits.map(h => `${h.file}:${h.line}  ${h.text}`)

describe('the founding country is not spelled where the city should be asked', () => {
  it('scans the tree', () => { expect(scanned).toBeGreaterThan(200) })
  it('no lira sign outside the money formatter — use formatMoney/currencySymbol with the city currency', () => {
    expect(show(lira)).toEqual([])
  })
  it("no 'TRY' literal outside lib/data.ts — use DEFAULT_CURRENCY, or better, the city's currency", () => {
    expect(show(code)).toEqual([])
  })
  it('no +90 outside lib/country.ts — use phonePlaceholder/dialCode with the city country', () => {
    expect(show(dial)).toEqual([])
  })
  it('no NEW file names the country', () => {
    const added = [...countryCounts.keys()].filter(f => !(f in COUNTRY_BASELINE)).sort()
    expect(added).toEqual([])
  })
  it('no existing file names it more', () => {
    const grown = [...countryCounts.entries()].filter(([f, n]) => f in COUNTRY_BASELINE && n > COUNTRY_BASELINE[f]).map(([f, n]) => `${f}: ${COUNTRY_BASELINE[f]} -> ${n}`).sort()
    expect(grown).toEqual([])
  })
})
