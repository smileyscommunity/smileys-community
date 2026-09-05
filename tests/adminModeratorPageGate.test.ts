import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  navItems,
  MODERATOR_BOTTOM_NAV,
  MODERATOR_ALLOWED_PATHS,
  isModeratorPageAllowed,
} from '@/lib/adminNav'

// The admin sidebar and the admin layout's moderator page gate used to be
// two hand-kept lists. They drifted: nine sidebar entries (and the mobile
// "Notify" tab) were shown to moderators and then bounced to Mod Home on
// load (docs/admin-panel-audit-2026-09-05.md, finding 1). The gate is now
// derived from the nav; this guard pins that every href the nav promises a
// moderator actually passes the gate, and that the layout uses the shared
// gate instead of growing its own list again.

const LAYOUT = readFileSync(join(process.cwd(), 'app/admin/layout.tsx'), 'utf8')

const pathOf = (href: string) => href.split('?')[0]

describe('admin layout moderator page gate', () => {
  it('admits every sidebar href a moderator can see', () => {
    const modItems = navItems.filter(i => i.roles.includes('moderator'))
    expect(modItems.length).toBeGreaterThan(10)
    const bounced = modItems.map(i => pathOf(i.href)).filter(p => !isModeratorPageAllowed(p))
    expect(bounced).toEqual([])
  })

  it('admits every sidebar href a moderator who hosts a club can see', () => {
    // The sidebar shows `host` items to a moderator with isClubHost.
    const hostItems = navItems.filter(i => i.roles.includes('host'))
    expect(hostItems.map(i => i.href)).toContain('/admin/events')
    const bounced = hostItems.map(i => pathOf(i.href)).filter(p => !isModeratorPageAllowed(p))
    expect(bounced).toEqual([])
  })

  it('admits every tab in the moderator mobile bottom nav', () => {
    expect(MODERATOR_BOTTOM_NAV.map(t => t.href)).toContain('/admin/notifications')
    const bounced = MODERATOR_BOTTOM_NAV.map(t => pathOf(t.href)).filter(p => !isModeratorPageAllowed(p))
    expect(bounced).toEqual([])
  })

  it('admits the non-nav pages moderators need', () => {
    for (const p of ['/admin/security', '/admin/checkin', '/admin/retention', '/admin/moderator']) {
      expect(isModeratorPageAllowed(p), p).toBe(true)
    }
    // Prefix semantics: detail pages under an allowed section pass too.
    expect(isModeratorPageAllowed('/admin/events/42')).toBe(true)
    expect(isModeratorPageAllowed('/admin/guide-entries')).toBe(true)
  })

  it('still bounces admin-only pages', () => {
    for (const p of ['/admin', '/admin/users', '/admin/analytics', '/admin/payments', '/admin/settings', '/admin/cities', '/admin/newsletter']) {
      expect(isModeratorPageAllowed(p), p).toBe(false)
    }
  })

  it('does not carry the retired /admin/engagement redirect stub', () => {
    expect(MODERATOR_ALLOWED_PATHS).not.toContain('/admin/engagement')
    expect(isModeratorPageAllowed('/admin/engagement')).toBe(false)
  })

  it('the layout uses the shared gate rather than its own list', () => {
    expect(LAYOUT).toMatch(/isModeratorPageAllowed\(pathname\)/)
    expect(LAYOUT).toMatch(/MODERATOR_BOTTOM_NAV/)
    expect(LAYOUT).not.toMatch(/MODERATOR_ALLOWED\s*=/)
    // No admin page path may be spelled out as a gate entry in the layout.
    expect(LAYOUT).not.toMatch(/'\/admin\/engagement'/)
  })
})
