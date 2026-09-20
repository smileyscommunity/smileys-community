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
      api.lastIndexOf("const gone = await tx.newsletter.deleteMany({ where: { id: replacesId, status: 'scheduled' } })"))
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

describe('3. a no-show cannot review, and a waive is what clears it', () => {
  // Rewritten for standing. This used to gate on v1's card table AND on
  // event.noShowProcessedAt. Standing writes neither: it settles an absence
  // on the attendee row and stamps no event, so the old gate's second
  // conjunct went permanently false and the whole check silently stopped
  // blocking anyone. The attendance mark is the test now, and a host waive
  // (lib/standing) is what lifts it — it puts the row back to 'attended'.
  const call = () => reviewPOST(
    new Request('http://x/api/events/e1/reviews', { method: 'POST', body: JSON.stringify({ rating: 5 }) }) as never,
    { params: Promise.resolve({ id: 'e1' }) })
  beforeEach(() => {
    p.event.findUnique.mockResolvedValue({ id: 'e1', cityId: 'c1', date: '2026-09-01' })
    p.review.findUnique.mockResolvedValue(null)
    p.review.create.mockResolvedValue({ id: 'r1' })
  })
  it('a member standing marked absent cannot review the night they missed', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ id: 'att1', status: 'approved', attendance: 'no_show' })
    expect((await call()).status).toBe(403)
    expect(p.review.create).not.toHaveBeenCalled()
  })
  it('…and no event stamp is needed for that — standing never writes one', async () => {
    // The regression this guards: with noShowProcessedAt absent (which is now
    // every event) the gate used to let the absentee through.
    p.eventAttendee.findUnique.mockResolvedValue({ id: 'att1', status: 'approved', attendance: 'no_show', attendanceAutoResolvedAt: new Date('2026-09-02') })
    expect((await call()).status).toBe(403)
  })
  it('a waived absence can review — the waive put the row back to attended', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ id: 'att1', status: 'approved', attendance: 'attended' })
    expect((await call()).status).toBe(200)
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
    // The reason is read once, where the PATCH is made, and carried to every screen.
    expect(read('lib/checkinQueue.ts')).toContain("return { kind: 'refused', error: typeof d?.error === 'string' ? d.error : 'Check-in update failed. Please try again.' }")
    expect(read('app/host/checkin/page.tsx')).toContain("const failure = outcome.kind === 'refused' ? outcome.error : null")
    expect(read('app/admin/checkin/page.tsx')).toContain("${a.user.name} — ${outcome.error}")
    expect(read('lib/checkin.ts')).toContain("message: outcome.kind === 'refused' ? outcome.error : 'No connection — the check-in was not saved.'")
    expect(read('components/ScanResultToast.tsx')).toContain('if (r.message) return r.name ? `${r.name}: ${r.message}` : r.message')
  })
})
