import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The host panel review (2026-09-19). A host could seat any member on their
// event and read the member's contact details back, or hand them a no-show
// for an event they never joined; re-saving a live event "to the series"
// published every unreviewed copy; a staff takedown could be undone by
// parking and reopening. These pin the fixes.

vi.mock('@/lib/prisma', () => ({ prisma: { auditLog: { findMany: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { wasStaffPublished } from '@/lib/eventPublishHistory'
import { sanitize } from '@/lib/sanitize'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('adding someone to an event', () => {
  const s = src('app/api/admin/events/[id]/participants/route.ts')
  const put = s.slice(s.indexOf('export async function PUT'), s.indexOf('export async function POST'))

  it('is an invitation for anyone but an admin — no seat, no contact details', () => {
    const inviteAt = put.indexOf('if (!isAdmin(session)) {')
    const seatAt   = put.indexOf('await activateAttendee(tx')
    expect(inviteAt).toBeGreaterThan(-1)
    expect(inviteAt).toBeLessThan(seatAt)
    expect(put).toContain("return NextResponse.json({ ok: true, invited: true })")
    expect(put).toContain('const inviteKey = `event-invite:${eventId}:${userId}`')
  })

  it('only invites a live member of the event\'s city who isn\'t hidden or blocked, to a live event', () => {
    expect(put).toContain("target.status !== 'approved'")
    expect(put).toContain('target.hiddenFromMembers || await isBlockedEitherWay(session.id, userId)')
    expect(put).toContain('!memberCities.includes(event.cityId) && target.cityId !== event.cityId')
    expect(put).toContain("event.status !== 'published' && event.status !== 'postponed'")
  })

  it('phone numbers are an admin\'s; emails go to a host who still holds a host role', () => {
    expect(s).toContain("const { email, phone: _p, ...user } = row.user")
    expect(s).toContain('await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0')
  })
})

describe('attendance on events that were never live', () => {
  it('close-out refuses anything but a published or archived event', () => {
    expect(src('app/api/events/[id]/checkin/close-out/route.ts'))
      .toContain("if (event.status !== 'published' && event.status !== 'archived') {")
  })
})

describe('what a host can do to an event\'s status', () => {
  const s = src('app/api/admin/events/[id]/route.ts')
  it('only draft, postponed, published (reopen) and cancelled — never archived', () => {
    expect(s).toContain("const HOST_STATUSES = ['draft', 'postponed', 'published', 'cancelled']")
  })
  it('an event with the moderators only goes to cancelled', () => {
    expect(s).toContain("['flagged', 'unpublished', 'pending'].includes(before.status) && rest.status !== 'cancelled'")
  })
  it('a started event can\'t be cancelled or postponed by its host', () => {
    expect(s).toMatch(/\(rest\.status === 'cancelled' \|\| rest\.status === 'postponed' \|\| rest\.status === 'draft'\) &&\s*\n\s*eventStartsAt\(before, await getCityTz\(before\.cityId\)\)\.getTime\(\) <= Date\.now\(\)/)
  })
  it('status never rides a series edit', () => {
    const line = s.slice(s.indexOf('const SERIES_EXCLUDED'), s.indexOf('const SERIES_EXCLUDED') + 250)
    for (const k of ['status', 'cancelledAt', 'cancelReason', 'featured', 'approvalRequired']) expect(line).toContain(`'${k}'`)
  })
  it('a host can\'t make an event stricter once people have joined, and edits are bounded', () => {
    expect(s).toContain("if (!admin && tier === 'scarce' && await prisma.eventAttendee.count({ where: { eventId: id, status: 'approved' } }) > 0) {")
    expect(s).toContain("const key = `event-details-changed:${eventId}`")
    expect(s).toContain("if (!whenChanged && !admin && !await claimOnce(key, 60 * 60_000)) continue")
    expect(s).toContain("rateLimit(`event-edit:${session.id}`, 60, 60 * 60_000)")
  })
})

describe('reopening after staff', () => {
  beforeEach(() => vi.clearAllMocks())
  const rows = (...actions: string[]) => (prisma.auditLog.findMany as any).mockResolvedValue(actions.map(action => ({ action, meta: null })))

  it('a publish that is staff\'s latest word reopens', async () => {
    rows('event.update', 'event.published')
    expect(await wasStaffPublished('e1')).toBe(true)
  })
  it('a flag, unpublish or send-back after the publish closes it again', async () => {
    for (const takedown of ['event.flagged', 'event.unpublished', 'event.pending']) {
      rows(takedown, 'event.published')
      expect(await wasStaffPublished('e1')).toBe(false)
    }
  })
  it('a publish after the takedown reopens again', async () => {
    rows('event.published', 'event.flagged', 'event.published')
    expect(await wasStaffPublished('e1')).toBe(true)
  })
})

describe('member-written HTML', () => {
  it('keeps our own uploaded images and drops anyone else\'s', () => {
    const out = sanitize('<p>Hi</p><img src="/app/api/files/events/abc.jpg"><img src="https://tracker.example/p.gif">')
    expect(out).toContain('/app/api/files/events/abc.jpg')
    expect(out).not.toContain('tracker.example')
  })
})

describe('other doors', () => {
  it('co-hosts are live members of the event\'s city, not hidden, not blocked', () => {
    const s = src('app/api/admin/events/[id]/cohosts/route.ts')
    expect(s).toContain('(user.suspendedUntil && user.suspendedUntil > new Date())')
    expect(s).toContain('user.hiddenFromMembers || await isBlockedEitherWay(session.id, userId)')
  })
  it('reviewer names only for an event the member can see', () => {
    expect(src('app/api/events/[id]/reviews/route.ts')).toContain('if (!event || !await canSeeEvent(event, session))')
  })
  it('a host\'s event is in the future', () => {
    expect(src('app/api/admin/events/route.ts')).toContain("if (!admin && !isModerator(session) && date < await todayInCity(eventCityId)) {")
  })
})
