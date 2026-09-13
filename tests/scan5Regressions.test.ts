import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 1–5: regressions introduced by the scan-4 fixes.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  event:         { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  noShowCard:    { findFirst: vi.fn() },
  review:        { findUnique: vi.fn(), create: vi.fn() },
}))
const h = vi.hoisted(() => ({ recompute: vi.fn(async () => {}), notify: vi.fn(async () => true) }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: h.recompute }))
vi.mock('@/lib/notify', () => ({ createNotification: h.notify }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => ({ id: 'u1', name: 'Ada' })) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/city', () => ({ todayInCity: vi.fn(async () => '2026-09-13') }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true) }))

import { restoreSeatsReleasedByCancel, RESTORE_WINDOW_MS } from '@/lib/eventRestore'
import { POST as reviewPOST } from '@/app/api/events/[id]/reviews/route'

beforeEach(() => { vi.clearAllMocks() })

describe('1. a failed send-now edit no longer strands the draft', () => {
  const api  = read('app/api/admin/newsletter/route.ts')
  const page = read('app/admin/newsletter/page.tsx')
  it('the API checks recipients before retiring the original', () => {
    expect(api.indexOf('const recipients = await prisma.user.findMany(')).toBeLessThan(
      api.indexOf("const gone = await prisma.newsletter.deleteMany({ where: { id: replacesId, status: 'scheduled' } })"))
  })
  it('every failure after the retire tells the page the original is gone', () => {
    expect(api.match(/originalRetired \}, \{ status: 502 \}\)/g)?.length).toBe(2)
  })
  it('the page stops treating the draft as a replacement on 409 or a retired original', () => {
    expect(page).toMatch(/if \(editingId && \(res\.status === 409 \|\| d\?\.originalRetired\)\) \{\s*const originalId = editingId\s*setEditingId\(null\)/)
  })
})

describe('2. restoring a cancelled event brings its seats back', () => {
  const stamp = new Date('2026-09-10T12:00:00.000Z')
  const ev = { id: 'e1', title: 'Picnic', totalSpots: 20, approvalRequired: false, cancelledAt: stamp }

  it('puts back exactly the seats the cancel released, as approved', async () => {
    p.eventAttendee.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'u2' }])
    const r = await restoreSeatsReleasedByCancel(ev)
    expect(r).toEqual({ restored: 2, status: 'approved' })
    expect(p.eventAttendee.findMany.mock.calls[0][0].where).toEqual({
      eventId: 'e1', status: 'removed', cancelledBy: { in: ['admin', 'host'] },
      cancelledAt: { gte: stamp, lte: new Date(stamp.getTime() + RESTORE_WINDOW_MS) },
    })
    expect(p.eventAttendee.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, status: 'removed' },
      data:  { status: 'approved', cancelledAt: null, cancelledBy: null },
    })
    expect(h.recompute).toHaveBeenCalledWith('e1', 20)
    expect(h.notify).toHaveBeenCalledTimes(2)
  })
  it('on an approval-required event they come back as requests for the host', async () => {
    p.eventAttendee.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1' }])
    const r = await restoreSeatsReleasedByCancel({ ...ev, approvalRequired: true })
    expect(r.status).toBe('pending')
    expect(p.eventAttendee.updateMany.mock.calls[0][0].data.status).toBe('pending')
  })
  it('does nothing without a cancellation stamp or released seats', async () => {
    expect(await restoreSeatsReleasedByCancel({ ...ev, cancelledAt: null })).toEqual({ restored: 0, status: null })
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
    p.eventAttendee.findMany.mockResolvedValue([])
    await restoreSeatsReleasedByCancel(ev)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(h.recompute).not.toHaveBeenCalled()
  })
  it('both restore paths call it, and the cancel stamps event and seats with one instant', () => {
    const route = read('app/api/admin/events/[id]/route.ts')
    expect(route.match(/restoreSeatsReleasedByCancel\(\{/g)?.length).toBe(2)
    expect(route).toContain('if (cancelling) data.cancelledAt = cancelStamp')
    expect(route).toContain("data:  { status: 'removed', cancelledAt: cancelStamp,")
    expect(route).toContain('data: restoring ? { status, cancelledAt: null } : { status }')
  })
})

describe('3. a cleared no-show card no longer blocks the review', () => {
  const call = () => reviewPOST(
    new Request('http://x/api/events/e1/reviews', { method: 'POST', body: JSON.stringify({ rating: 5 }) }) as never,
    { params: Promise.resolve({ id: 'e1' }) })
  beforeEach(() => {
    p.event.findUnique.mockResolvedValue({ id: 'e1', cityId: 'c1', date: '2026-09-01' })
    p.eventAttendee.findUnique.mockResolvedValue({ id: 'att1', status: 'approved', attendance: 'no_show' })
    p.review.findUnique.mockResolvedValue(null)
    p.review.create.mockResolvedValue({ id: 'r1' })
  })
  it('a no-show whose card was waived or overturned can review', async () => {
    p.noShowCard.findFirst.mockResolvedValue({ id: 'card1' })
    expect((await call()).status).toBe(200)
    expect(p.noShowCard.findFirst.mock.calls[0][0].where).toEqual({ attendeeId: 'att1', status: { in: ['waived', 'overturned'] } })
  })
  it('a no-show with no cleared card still cannot', async () => {
    p.noShowCard.findFirst.mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(p.review.create).not.toHaveBeenCalled()
  })
})

describe('4. the orphan sweep takes a last look before each delete', () => {
  it('re-checks references and age per file, and apply refreshes the photo it claims', () => {
    const sweep = read('app/api/cron/sweep-orphan-uploads/route.ts')
    const loop  = sweep.slice(sweep.indexOf('for (const name of batch)'))
    expect(loop.indexOf('await stillReferenced(name)')).toBeLessThan(loop.indexOf('await unlink('))
    expect(loop.indexOf('.mtimeMs >= cutoff')).toBeLessThan(loop.indexOf('await unlink('))
    expect(read('app/api/apply/route.ts')).toContain("utimesSync(join(uploadRoot(), 'applications', photoFile), now, now)")
  })
})

describe('5. check-in screens show why the server refused', () => {
  it('host page, admin page, scan hook and toast all carry the server reason', () => {
    expect(read('app/host/checkin/page.tsx')).toContain("failure = typeof d?.error === 'string' ? d.error : 'Check-in update failed. Please try again.'")
    expect(read('app/host/checkin/page.tsx')).toContain("failure = 'No connection — the check-in was not saved. Please try again.'")
    expect(read('app/admin/checkin/page.tsx')).toContain("${reason ? ` — ${reason}` : ''}")
    expect(read('lib/checkin.ts')).toContain("flash({ type: 'error', name: attendee.user.name, ...(reason ? { message: reason } : {}) })")
    expect(read('components/ScanResultToast.tsx')).toContain('if (r.message) return r.name ? `${r.name}: ${r.message}` : r.message')
  })
})
