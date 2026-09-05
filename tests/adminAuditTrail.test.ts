import { describe, it, expect, vi, beforeEach } from 'vitest'

// docs/admin-panel-audit-2026-09-05.md finding 3: four admin routes that
// email members left no audit row saying who pressed the button. The rows
// were added in 6358def without a test; this pins them so a refactor cannot
// quietly drop one. Shown failing against the pre-6358def routes first.
//
// Each case drives the route to the point where mail goes out and asserts
// the row names the action and the admin who caused it. The login nudge
// also pins its deliberate exception: a press that found nobody is not a row.

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',     () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/email',     () => ({
  sendEventReminderEmail: vi.fn(async () => {}),
  sendNoShowEmail:        vi.fn(async () => {}),
  sendLoginNudgeEmail:    vi.fn(async () => {}),
  sendActivationEmail:    vi.fn(async () => {}),
  recordEmailFailure:     vi.fn(async () => {}),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event:         { findUnique: vi.fn() },
    eventAttendee: { findMany: vi.fn(async () => [{ userId: 'm1', user: { id: 'm1', name: 'Mia', email: 'mia@x' } }]) },
    noShowCard:    { findMany: vi.fn(async () => []) },
    user: {
      findMany:   vi.fn(),
      findUnique: vi.fn(async () => ({ id: 'm1', name: 'Mia', email: 'mia@x', password: null, status: 'approved', city: { name: 'Izmir' } })),
      update:     vi.fn(async () => ({})),
    },
    passwordResetToken: { deleteMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
  },
}))

import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { POST as remindPOST }  from '@/app/api/admin/events/[id]/remind-attendees/route'
import { POST as noShowsPOST } from '@/app/api/admin/events/[id]/notify-noshows/route'
import { POST as nudgePOST }   from '@/app/api/admin/tools/login-nudge/route'
import { POST as resendPOST }  from '@/app/api/admin/users/[id]/resend-approval/route'

const ADMIN  = { id: 'a1', name: 'Admin', email: 'a@x', role: 'admin', color: '#000', cityId: 'c-ist' }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req    = new Request('https://x') as never

function auditedAs(action: string) {
  const call = (writeAudit as any).mock.calls.find((c: unknown[]) => c[2] === action)
  expect(call, `no audit row for ${action}`).toBeDefined()
  expect(call[0]).toBe('a1')
  expect(call[1]).toBe('Admin')
  return call
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(ADMIN)
})

describe('audit rows on the routes that email members', () => {
  it('remind-attendees writes event.remind_attendees with the counts', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue({ id: 'e1', title: 'Picnic', emoji: '🧺', date: '2099-01-01', location: null, cityId: 'c-ist', price: null, memberPrice: null })
    const res = await remindPOST(req, params('e1'))
    expect(res.status).toBe(200)
    const call = auditedAs('event.remind_attendees')
    expect(call[3]).toBe('e1')
    expect(call[5]).toMatchObject({ attendees: 1, emailed: 1, cityId: 'c-ist' })
  })

  it('notify-noshows writes event.notify_noshows', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue({ id: 'e2', title: 'Picnic', emoji: '🧺', date: '2000-01-01', cityId: 'c-ist' })
    const res = await noShowsPOST(req, params('e2'))
    expect(res.status).toBe(200)
    const call = auditedAs('event.notify_noshows')
    expect(call[3]).toBe('e2')
    expect(call[5]).toMatchObject({ noShows: 1, emailed: 1 })
  })

  it('login-nudge writes users.login_nudge when someone was nudged', async () => {
    ;(prisma.user.findMany as any).mockResolvedValue([{ id: 'm1', name: 'Mia', email: 'mia@x', nudgesSent: 0 }])
    const res = await nudgePOST()
    expect(res.status).toBe(200)
    const call = auditedAs('users.login_nudge')
    expect(call[5]).toMatchObject({ sent: 1, failed: 0, candidates: 1 })
  })

  it('login-nudge writes nothing when nobody qualified', async () => {
    ;(prisma.user.findMany as any).mockResolvedValue([])
    const res = await nudgePOST()
    expect(res.status).toBe(200)
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('resend-approval writes user.resend_activation against the member', async () => {
    const res = await resendPOST(req, params('m1'))
    expect(res.status).toBe(200)
    const call = auditedAs('user.resend_activation')
    expect(call[3]).toBe('m1')
    expect(call[4]).toBe('user')
  })
})
