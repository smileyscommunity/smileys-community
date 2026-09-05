import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// docs/admin-panel-audit-2026-09-05.md findings 4 and 5. Three pages turned a
// failed request into their empty state — `r.ok ? r.json() : []` — so a 403
// or a 500 read as a quiet day (on Mod Home, the moderator's landing page,
// as "no work"). And the layout computed a `bottomNav` on every render that
// nothing rendered. Source-level ratchets, in the style of the moderator
// page-gate test: cheap, and they fail the moment either pattern comes back.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PAGES = ['app/admin/audit/page.tsx', 'app/admin/moderator/page.tsx', 'app/admin/nps/page.tsx']

describe('admin pages surface a failed load instead of an empty state', () => {
  for (const p of PAGES) {
    it(`${p} does not swallow !r.ok`, () => {
      const src = read(p)
      expect(src).not.toMatch(/\.ok\s*\?\s*(await\s+)?\w+\.json\(\)\s*:/)
      expect(src).toMatch(/<LoadErrorBanner\b/)
      expect(src).toMatch(/loadFailure\(/)
    })
  }
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
