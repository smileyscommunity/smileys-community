import { describe, it, expect, vi, beforeEach } from 'vitest'

// Retention > Never attended / Dormant re-engagement emails: a bulk email to
// members, so the guards are the point — who may press it, that a send is
// recorded only after it succeeds, and that nobody gets it twice.
const queue   = vi.hoisted(() => ({ rows: [] as { id: string; name: string | null; email: string }[], remaining: 0 }))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const mail    = vi.hoisted(() => ({ sendBroadcastEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
const audit   = vi.hoisted(() => ({ writeAudit: vi.fn(async () => {}) }))
const claims  = vi.hoisted(() => ({ free: true, keys: [] as string[], released: [] as string[] }))
const stepUp  = vi.hoisted(() => ({ block: false }))
const take    = vi.hoisted(() => ({ seen: [] as unknown[] }))

vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/email', () => mail)
vi.mock('@/lib/audit', () => audit)
vi.mock('@/lib/rateLimit', () => ({
  claimOnce:    vi.fn(async (k: string) => { claims.keys.push(k); return claims.free }),
  releaseClaim: vi.fn(async (k: string) => { claims.released.push(k) }),
}))
vi.mock('@/lib/stepUp', () => ({
  requireStepUp: vi.fn(() => stepUp.block ? new Response(JSON.stringify({ error: 'Two-factor verification required' }), { status: 403 }) : null),
}))
vi.mock('@/lib/retentionEmail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/retentionEmail')>('@/lib/retentionEmail')
  return {
    ...actual,
    retentionQueue:     vi.fn(async (_k: string, _n: Date, t?: number) => { take.seen.push(t); return queue.rows }),
    retentionRemaining: vi.fn(async () => queue.remaining),
  }
})

import { POST } from '@/app/api/admin/retention/email/route'
import { RETENTION_EMAIL, RETENTION_EMAIL_BATCH, isRetentionEmailKind } from '@/lib/retentionEmail'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', cityId: 'c1' }
const req = (body: unknown) => new Request('http://x/app/api/admin/retention/email', { method: 'POST', body: JSON.stringify(body) }) as never
const m = (id: string) => ({ id, name: `Member ${id}`, email: `${id}@x.com` })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 })
  session.current = admin
  claims.free = true; claims.keys = []; claims.released = []
  stepUp.block = false
  take.seen = []
  queue.rows = []; queue.remaining = 0
})

describe('kinds and copy', () => {
  it('knows only the two kinds, each with its own audit action', () => {
    expect(isRetentionEmailKind('never_attended')).toBe(true)
    expect(isRetentionEmailKind('dormant')).toBe(true)
    expect(isRetentionEmailKind('all')).toBe(false)
    expect(RETENTION_EMAIL.never_attended.action).not.toBe(RETENTION_EMAIL.dormant.action)
  })
})

describe('POST /api/admin/retention/email', () => {
  it('emails a batch with that kind\'s copy and records each send', async () => {
    queue.rows = [m('u1'), m('u2')]; queue.remaining = 40
    const res = await POST(req({ kind: 'dormant' }))
    expect(await res.json()).toEqual({ sent: 2, failed: 0, remaining: 40 })
    expect(take.seen).toEqual([RETENTION_EMAIL_BATCH])
    expect(mail.sendBroadcastEmail).toHaveBeenCalledTimes(2)
    expect(mail.sendBroadcastEmail).toHaveBeenCalledWith('u1', 'u1@x.com', 'Member u1', RETENTION_EMAIL.dormant.subject, RETENTION_EMAIL.dormant.message)
    expect(audit.writeAudit).toHaveBeenCalledWith('a1', 'Adm', RETENTION_EMAIL.dormant.action, 'u1', 'user', expect.anything(), expect.any(String))
  })

  it('a failed send is not recorded, so it stays in the queue', async () => {
    queue.rows = [m('u1'), m('u2')]
    mail.sendBroadcastEmail.mockRejectedValueOnce(new Error('resend down'))
    const body = await (await POST(req({ kind: 'never_attended' }))).json()
    expect(body).toMatchObject({ sent: 1, failed: 1 })
    expect(audit.writeAudit).toHaveBeenCalledTimes(1)
    expect(audit.writeAudit.mock.calls[0][3]).toBe('u2')
    expect(mail.recordEmailFailure).toHaveBeenCalled()
  })

  it('rejects an unknown kind before reading the queue', async () => {
    expect((await POST(req({ kind: 'everyone' }))).status).toBe(400)
    expect((await POST(req({}))).status).toBe(400)
    expect(mail.sendBroadcastEmail).not.toHaveBeenCalled()
  })

  it.each(['moderator', 'member'])('refuses a %s', async (role) => {
    session.current = { ...admin, role }
    expect((await POST(req({ kind: 'dormant' }))).status).toBe(403)
    expect(mail.sendBroadcastEmail).not.toHaveBeenCalled()
  })

  it('needs the same second factor as a newsletter send', async () => {
    stepUp.block = true
    expect((await POST(req({ kind: 'dormant' }))).status).toBe(403)
    expect(mail.sendBroadcastEmail).not.toHaveBeenCalled()
  })

  it('one batch at a time per kind across admins, and the lock is released', async () => {
    claims.free = false
    expect((await POST(req({ kind: 'dormant' }))).status).toBe(409)
    expect(mail.sendBroadcastEmail).not.toHaveBeenCalled()
    claims.free = true
    await POST(req({ kind: 'dormant' }))
    expect(claims.keys.at(-1)).toBe('retention-email:dormant')
    expect(claims.released).toEqual(['retention-email:dormant'])
  })
})
