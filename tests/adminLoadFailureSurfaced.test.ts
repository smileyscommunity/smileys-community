import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// docs/admin-panel-audit-2026-09-05.md findings 4 and 5. Three pages (and,
// on a second sweep, five more) turned a failed request into their empty
// state — `r.ok ? r.json() : []` — so a 403 or a 500 read as a quiet day (on
// Mod Home, the moderator's landing page, as "no work"). And the layout computed a `bottomNav` on every render that
// nothing rendered. Source-level ratchets, in the style of the moderator
// page-gate test: cheap, and they fail the moment either pattern comes back.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SWALLOW = /\.ok\s*\?\s*(await\s+)?\w+\.json\(\)\s*:/g

// Page → how many `r.ok ? r.json() : …` fallbacks it may still keep. Zero
// for the three the audit named and the four found on the same sweep
// (retention, feedback, campaign detail, the users list — which never
// checked r.ok at all — and the broadcast history). The non-zero ones are
// secondary lookups that may fail quietly without misleading anyone: a
// sample event for feedback's empty-state link, the broadcast composer's
// option lists, the users page's connection flags. The primary load on
// every page here goes through loadFailure and renders LoadErrorBanner.
const PAGES: Record<string, number> = {
  'app/admin/audit/page.tsx':          0,
  'app/admin/moderator/page.tsx':      0,
  'app/admin/nps/page.tsx':            0,
  'app/admin/retention/page.tsx':      0,
  'app/admin/campaigns/[id]/page.tsx': 0,
  'app/admin/feedback/page.tsx':       1,
  'app/admin/notifications/page.tsx':  3,
  'app/admin/users/page.tsx':          1,
}

describe('admin pages surface a failed load instead of an empty state', () => {
  for (const [p, allowed] of Object.entries(PAGES)) {
    it(`${p} does not swallow !r.ok on its primary load`, () => {
      const src = read(p)
      const swallowed = src.match(SWALLOW)?.length ?? 0
      expect(swallowed, `secondary-lookup fallbacks in ${p}`).toBeLessThanOrEqual(allowed)
      expect(src).toMatch(/<LoadErrorBanner\b/)
      expect(src).toMatch(/loadFailure\(/)
    })
  }
  it('the users list checks r.ok before trusting the body', () => {
    const src = read('app/admin/users/page.tsx')
    expect(src).not.toMatch(/admin\/users\$\{q\}`[^\n]*\n\s*\.then\(r => r\.json\(\)\)/)
  })
  it('the helper reports status and the start of the body', async () => {
    const { loadFailure } = await import('@/lib/admin/useAdminLoad')
    const err = await loadFailure(new Response('{"error":"Moderator has no city"}', { status: 403 }))
    expect(err.message).toBe('403: {"error":"Moderator has no city"}')
  })
})

describe('admin layout keeps no dead nav code', () => {
  it('no bottomNav computed from navItems', () => {
    const src = read('app/admin/layout.tsx')
    expect(src).not.toMatch(/bottomNav/)
    expect(src).not.toMatch(/\bnavItems\b/)
  })
})
