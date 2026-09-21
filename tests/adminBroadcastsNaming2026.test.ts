import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NAV_GROUPS, navItems, isModeratorPageAllowed } from '@/lib/adminNav'

// 2026-09-22. /admin/notifications was called "Notifications" — the same name
// the member-facing bell and /notifications already carry. An admin clicking
// it reasonably expects to READ notifications; the page composes and sends
// them. The code had agreed with the better name all along: the record type
// is BroadcastRecord, the endpoint is /broadcast, the history block is
// "Broadcast History", and the Command Palette entry's id is 'a-broadcast'
// while its label said something else and its hint had to explain.
//
// The page also carried a "Scheduled Jobs" block — the reminders cron — which
// is not something you compose. That moved to /admin/jobs, where the other 18
// sweepers' health is finally readable too.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('the admin broadcasts page is named for what it does', () => {
  const page = src('app/admin/notifications/page.tsx')

  it('says Broadcasts once, and never calls itself Notifications', () => {
    expect(page).toContain('<h1 className="text-white text-2xl font-extrabold">Broadcasts</h1>')
    expect(page).not.toMatch(/>Notifications</)
  })

  it('the Command Palette agrees with the page and its own id', () => {
    const palette = src('components/CommandPalette.tsx')
    expect(palette).toContain("id: 'a-broadcast',    label: 'Broadcasts',")
    expect(palette).toContain("id: 'a-jobs',         label: 'Jobs',")
    // The member's own bell keeps the name — it is the surface that READS
    // notifications, which is the whole reason the admin one couldn't have
    // it. Exactly one entry may be called Notifications, and it points at
    // the member page.
    const named = [...palette.matchAll(/label: 'Notifications',[\s\S]{0,160}?go\('([^']+)'\)/g)].map(m => m[1])
    expect(named).toEqual(['/notifications'])
  })

  it('the URL is left alone — it is not copy anyone reads', () => {
    // Renaming the route would break every bookmark and the API path under
    // it for no reader's benefit.
    expect(src('components/CommandPalette.tsx')).toContain("go('/admin/notifications')")
  })
})

describe('the scheduled jobs moved out', () => {
  it('the broadcasts page no longer runs a cron', () => {
    const page = src('app/admin/notifications/page.tsx')
    expect(page).not.toContain('Scheduled Jobs')
    expect(page).not.toContain('runCron')
    expect(page).not.toContain('api/admin/cron/reminders')
  })

  it('and /admin/jobs reads every sweeper, admin only', () => {
    const route = src('app/api/admin/jobs/route.ts')
    expect(route).toContain('if (!session || !isAdmin(session)) return NextResponse.json({ error: \'Forbidden\' }, { status: 403 })')
    expect(route).toContain('const names = Object.keys(SWEEPER_INTERVAL_MIN)')
    // The one job an admin may fire by hand — the block that used to sit on
    // the broadcasts page.
    expect(route).toContain("endpoint:    '/app/api/admin/cron/reminders',")
  })

  it('a failing job is not reported as healthy just because it ran recently', () => {
    const route = src('app/api/admin/jobs/route.ts')
    expect(route).toContain("if (!row?.lastSuccessAt) state = 'never'")
    expect(route).toContain("else if (row.lastErrorAt && row.lastErrorAt > row.lastSuccessAt) state = 'error'")
    expect(route).toContain("else if (minutesSince !== null && minutesSince > intervalMin * 2) state = 'stale'")
  })

  it('state is settled on the server, not recomputed in the browser', () => {
    // A client deriving "stale" from Date.now() disagrees with the server
    // across a render boundary — the trap the handbook review chip documents.
    expect(src('app/api/admin/jobs/route.ts')).toContain('const now = Date.now()')
    expect(src('app/admin/jobs/page.tsx')).not.toMatch(/intervalMin \* 2/)
  })
})

// The rename and the new page reached the Command Palette first and the
// sidebar second, which for a while left the sidebar saying "Notifications"
// over a page headed "Broadcasts", and made /admin/jobs reachable only by
// someone who knew to press ⌘K.
describe('the admin sidebar agrees with both pages', () => {
  const byLabel = (label: string) => navItems.filter(i => i.label === label)

  it('names the broadcasts entry for the page it opens', () => {
    expect(byLabel('Broadcasts').map(i => i.href)).toEqual(['/admin/notifications'])
    expect(byLabel('Notifications')).toEqual([])
  })

  it('offers Jobs under System, where the other plumbing lives', () => {
    const system = NAV_GROUPS.find(g => g.label === 'System')!.items
    expect(system.map(i => i.href)).toContain('/admin/jobs')
  })

  it('shows Jobs to exactly the role the API answers', () => {
    // app/api/admin/jobs returns 403 to a moderator. The gate is derived
    // from this nav, so a 'moderator' role here would advertise the page
    // and then bounce them — the 2026-09-05 drift, one entry at a time.
    const jobs = navItems.find(i => i.href === '/admin/jobs')!
    expect(jobs.roles).toEqual(['admin'])
    expect(isModeratorPageAllowed('/admin/jobs')).toBe(false)
  })

  it('every nav entry has a glyph to draw', () => {
    // A missing key renders nothing at all — no fallback, no error. Read as
    // text because Sidebar.tsx holds module-level JSX vitest cannot parse.
    const sidebar = src('components/admin/Sidebar.tsx')
    const icons   = sidebar.slice(sidebar.indexOf('const ICONS'), sidebar.indexOf('export const ICON_PATHS'))
    const missing = [...new Set(navItems.map(i => i.icon))].filter(n => !icons.includes(`\n  ${n}:`))
    expect(missing).toEqual([])
  })
})
