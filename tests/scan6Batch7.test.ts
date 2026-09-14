import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Sixth scan, batch 7 — batch approvals and the capacity confirm.
//   a. the participants inbox approves requests for many events in one click,
//      but kept ONE "exceed capacity?" answer: event A's yes seated event B
//      over its cap unasked, and A's no turned B's approvals into failures.
//      Now one confirm per event (capacityConfirmPerEvent).
//   b. after "Keep the cap", refused requests are "left pending (at capacity)"
//      in the summary, not failures (leftAtCapacity) — per-event page + inbox.

const read = (p: string) => readFileSync(p, 'utf8')

const h = vi.hoisted(() => ({ confirmToast: vi.fn() }))
vi.mock('@/lib/confirmToast', () => ({ confirmToast: h.confirmToast }))

import { capacityConfirmPerEvent, capacityConfirmForBatch, leftAtCapacity } from '@/lib/admin/overCapacity'

type Counts = { approved: number; totalSpots: number }
const refused = ({ approved, totalSpots }: Counts) =>
  new Response(JSON.stringify({ error: 'This event is full', code: 'over_capacity', approved, totalSpots }), { status: 409 })
const ok = () => new Response('{"ok":true}', { status: 200 })

// A fake server: each event is full; only a request carrying the override is seated.
function server(events: Record<string, Counts>) {
  const sent: { eventId: string; allow: boolean }[] = []
  const sendFor = (eventId: string) => async (allow: boolean) => {
    sent.push({ eventId, allow })
    return allow ? ok() : refused(events[eventId])
  }
  return { sent, sendFor }
}

beforeEach(() => { vi.clearAllMocks() })

describe('a. capacityConfirmPerEvent', () => {
  it('asks once per event with that event\'s counts; the override only reaches the event that said yes', async () => {
    const srv = server({ A: { approved: 3, totalSpots: 10 }, B: { approved: 7, totalSpots: 8 } })
    // Script the answers per event: A → yes, B → no.
    h.confirmToast.mockImplementation(async (q: string) => q.includes('3 of 10'))
    const confirms = capacityConfirmPerEvent()
    const order = ['A', 'A', 'B', 'A', 'B', 'B']
    const statuses: number[] = []
    for (const e of order) statuses.push((await confirms.forEvent(e)(srv.sendFor(e))).status)

    expect(h.confirmToast).toHaveBeenCalledTimes(2)
    expect(h.confirmToast.mock.calls[0][0]).toContain('3 of 10 seats are already taken')
    expect(h.confirmToast.mock.calls[1][0]).toContain('7 of 8 seats are already taken')
    expect(srv.sent.filter(s => s.eventId === 'B').every(s => !s.allow)).toBe(true)
    expect(srv.sent.filter(s => s.eventId === 'A' && s.allow)).toHaveLength(3)
    expect(statuses).toEqual([200, 200, 409, 200, 409, 409])
  })

  it('the reverse: A says no, B says yes — B is seated, A stays refused', async () => {
    const srv = server({ A: { approved: 3, totalSpots: 10 }, B: { approved: 7, totalSpots: 8 } })
    h.confirmToast.mockImplementation(async (q: string) => q.includes('7 of 8'))
    const confirms = capacityConfirmPerEvent()
    for (const e of ['A', 'B', 'A', 'B']) await confirms.forEvent(e)(srv.sendFor(e))
    expect(h.confirmToast).toHaveBeenCalledTimes(2)
    expect(srv.sent).toEqual([
      { eventId: 'A', allow: false },
      { eventId: 'B', allow: false }, { eventId: 'B', allow: true },
      { eventId: 'A', allow: false },
      { eventId: 'B', allow: true },
    ])
  })

  it('the same event returns the same confirm; a fresh set asks again', async () => {
    const confirms = capacityConfirmPerEvent()
    expect(confirms.forEvent('A')).toBe(confirms.forEvent('A'))
    expect(confirms.forEvent('A')).not.toBe(confirms.forEvent('B'))
    expect(capacityConfirmPerEvent().forEvent('A')).not.toBe(confirms.forEvent('A'))
  })

  it('an event with free seats never asks', async () => {
    const confirms = capacityConfirmPerEvent()
    const send = vi.fn(async () => ok())
    expect((await confirms.forEvent('C')(send)).status).toBe(200)
    expect(send.mock.calls).toEqual([[false]])
    expect(h.confirmToast).not.toHaveBeenCalled()
  })
})

describe('b. leftAtCapacity', () => {
  it('true only for a refusal that is still over_capacity, and leaves the body readable', async () => {
    const res = refused({ approved: 10, totalSpots: 10 })
    expect(await leftAtCapacity(res)).toBe(true)
    expect((await res.json()).error).toBe('This event is full')
    expect(await leftAtCapacity(ok())).toBe(false)
    expect(await leftAtCapacity(new Response(JSON.stringify({ code: 'below_approved_seats', approved: 3, totalSpots: 2 }), { status: 400 }))).toBe(false)
    expect(await leftAtCapacity(new Response(JSON.stringify({ error: 'paused', code: 'red_card_blocked' }), { status: 409 }))).toBe(false)
    expect(await leftAtCapacity(new Response('oops', { status: 500 }))).toBe(false)
  })

  it('after a no, every later refusal in that batch reads as left at capacity', async () => {
    h.confirmToast.mockResolvedValueOnce(false)
    const batch = capacityConfirmForBatch()
    const send = vi.fn(async (allow: boolean) => allow ? ok() : refused({ approved: 5, totalSpots: 5 }))
    for (let i = 0; i < 3; i++) expect(await leftAtCapacity(await batch(send))).toBe(true)
    expect(send.mock.calls.every(([allow]) => !allow)).toBe(true)
  })
})

// ── source pins ────────────────────────────────────────────────────────────
describe('pages wire the per-event confirm and count at-capacity separately', () => {
  const between = (src: string, start: string, end: string) => {
    const i = src.indexOf(start)
    const j = src.indexOf(end, i + start.length)
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    return src.slice(i, j)
  }
  const inbox    = read('app/admin/participants/page.tsx')
  const perEvent = read('app/admin/events/[id]/participants/page.tsx')
  const host     = read('app/host/events/[id]/participants/page.tsx')

  it('inbox bulk: a per-event confirm per click, looked up by the row\'s event', () => {
    expect(inbox).not.toContain('capacityConfirmForBatch')
    const patch = between(inbox, 'const patchAction', 'const bulkApprove')
    expect(patch).toContain("confirms = capacityConfirmPerEvent()) => async (a: Attendee) => {")
    expect(patch).toContain('const sendChecked = confirms.forEvent(a.eventId)')
    expect(patch).toContain("if (!res.ok) return (await leftAtCapacity(res)) ? 'at_capacity' as const : false")
    // patchAction(...) is evaluated per click, so answers never outlive the click.
    expect(inbox).toContain("const bulkApprove = () => bulkRun('Approve', 'Approve', patchAction('approve'),")
  })

  it('inbox summary: at-capacity rows are their own line, not failures', () => {
    const run = between(inbox, 'async function bulkRun(', 'const patchAction')
    expect(run).toContain("else if (r === 'at_capacity') atCapacity++")
    expect(run.indexOf("r === 'at_capacity'")).toBeLessThan(run.indexOf('else if (r) {'))
    expect(run).toContain('if (atCapacity) toast.warning(`${atCapacity} left pending (at capacity)`)')
  })

  it('per-event batch: a kept cap is counted before failed++, and the summary says so', () => {
    const run = between(perEvent, 'async function runBatch(', 'async function approveAll(')
    expect(run).toContain('const sendChecked = capacityConfirmForBatch()')  // single event: one answer is right
    const keptAt = run.indexOf('if (await leftAtCapacity(res)) { atCapacity++; continue }')
    expect(keptAt).toBeGreaterThan(-1)
    expect(keptAt).toBeLessThan(run.indexOf('failed++'))
    const summary = run.slice(run.indexOf('} finally {'))
    expect(summary).toContain("const heldAs = method === 'PATCH' ? 'left pending' : 'left on the waitlist'")
    expect(summary).toContain('if (failed === 0 && atCapacity > 0) toast.warning(`${verb} ${ok} · ${atCapacity} ${heldAs} (at capacity)`)')
    expect(summary).toMatch(/else if \(ok === 0\) toast\.error\(`[^\n]*\$\{held\}`\)/)
    expect(summary).not.toMatch(/failed[^\n]*Confirm to seat/)
  })

  it('host page has no batch — every seat action asks on its own', () => {
    expect(host).not.toMatch(/capacityConfirm(ForBatch|PerEvent)/)
  })
})
