import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Fifth scan, batch 43.
//   a) Resend's emails.send resolves { error } instead of throwing, and most
//      lib/email helpers ignored it: a refused email counted as sent and never
//      reached EmailFailure. One send() wrapper now records every refusal and
//      throws only for helpers whose callers report the failure.
//   b) the payments, members and pro-waitlist CSV exports quoted cells but
//      never neutralised formulas (=, +, -, @).
//   c) the admin Sidebar polled mod-stats on its own 60s timer and ignored
//      smileys:moderation-changed; it now shares the Topbar's useModCounts.

const read = (p: string) => readFileSync(p, 'utf-8')

const h = vi.hoisted(() => ({
  resendSend: vi.fn(),
  batchSend:  vi.fn(),
  prisma: {
    user:         { findMany: vi.fn() },
    emailFailure: { create: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.resendSend }
    batch  = { send: h.batchSend }
  },
}))
vi.mock('@/lib/unsubscribe', () => ({
  unsubscribeUrl:         () => 'https://example.test/unsub',
  oneClickUnsubscribeUrl: () => 'https://example.test/unsub-1c',
}))

process.env.RESEND_API_KEY = 'test-key'

// A fresh object per response, as Resend returns.
const refusal = () => ({ name: 'validation_error', message: 'The smileys.test domain is not verified', statusCode: 403 })

beforeEach(() => {
  h.resendSend.mockReset()
  h.batchSend.mockReset()
  h.prisma.user.findMany.mockReset()
  h.prisma.emailFailure.create.mockReset()
  h.prisma.user.findMany.mockResolvedValue([])
  h.prisma.emailFailure.create.mockResolvedValue({ id: 'f1' })
  h.resendSend.mockResolvedValue({ data: { id: 'm1' }, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

const rows = () => h.prisma.emailFailure.create.mock.calls.map(c => c[0].data)

// ── a) the send wrapper ────────────────────────────────────────────────────
describe('a) a refused email is recorded, and thrown only where the caller reports it', () => {
  it('record-only helper: resolves (RSVP flow unchanged) but writes one EmailFailure row', async () => {
    const { sendRsvpConfirmationEmail } = await import('@/lib/email')
    h.resendSend.mockResolvedValue({ data: null, error: refusal() })
    await expect(sendRsvpConfirmationEmail('ada@example.test', 'Ada', 'Walk', '2026-09-20', 'Moda', 'e1')).resolves.toBeUndefined()
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ helper: 'sendRsvpConfirmationEmail', recipient: 'ada@example.test' })
    expect(rows()[0].error).toContain('domain is not verified')
  })

  it('other record-only helpers (approval, activation, reset) resolve and record under their own name', async () => {
    const mail = await import('@/lib/email')
    h.resendSend.mockResolvedValue({ data: null, error: refusal() })
    await expect(mail.sendEventApprovedEmail('a@example.test', 'Ada', 'Walk', '2026-09-20', 'Moda', 'e1')).resolves.toBeUndefined()
    await expect(mail.sendActivationEmail('b@example.test', 'Bo', 'tok')).resolves.toBeUndefined()
    await expect(mail.sendPasswordResetEmail('c@example.test', 'Cy', 'tok')).resolves.toBeUndefined()
    expect(rows().map(r => [r.helper, r.recipient])).toEqual([
      ['sendEventApprovedEmail', 'a@example.test'],
      ['sendActivationEmail', 'b@example.test'],
      ['sendPasswordResetEmail', 'c@example.test'],
    ])
  })

  it('an accepted email records nothing', async () => {
    const { sendRsvpConfirmationEmail } = await import('@/lib/email')
    await sendRsvpConfirmationEmail('ada@example.test', 'Ada', 'Walk', '2026-09-20', 'Moda', 'e1')
    expect(h.resendSend).toHaveBeenCalledTimes(1)
    expect(h.prisma.emailFailure.create).not.toHaveBeenCalled()
  })

  it('throwing helper: rejects with a readable Error, and the caller\'s own record does not double the row', async () => {
    const { sendLoginNudgeEmail, recordEmailFailure } = await import('@/lib/email')
    h.resendSend.mockResolvedValue({ data: null, error: refusal() })
    let caught: unknown
    try { await sendLoginNudgeEmail('ada@example.test', 'Ada', 'tok', 1) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('domain is not verified')
    // What the login-nudge routes do in their catch.
    await recordEmailFailure({ helper: 'sendLoginNudgeEmail', recipient: 'ada@example.test', error: caught })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ helper: 'sendLoginNudgeEmail', recipient: 'ada@example.test' })
  })

  it('dedupe is only for errors send() recorded: any other failure still writes', async () => {
    const { recordEmailFailure } = await import('@/lib/email')
    await recordEmailFailure({ helper: 'sendX', recipient: 'x@example.test', error: new Error('boom') })
    await recordEmailFailure({ helper: 'sendX', recipient: 'x@example.test', error: { message: 'plain' } })
    expect(rows()).toHaveLength(2)
  })

  it('sendFinishRegistrationEmail still throws on a resolved { error }, and records it', async () => {
    const { sendFinishRegistrationEmail } = await import('@/lib/email')
    h.resendSend.mockResolvedValue({ data: null, error: refusal() })
    await expect(sendFinishRegistrationEmail('ada@example.test', 'Ada', 'tok')).rejects.toThrow(/not verified/)
    expect(rows()).toMatchObject([{ helper: 'sendFinishRegistrationEmail' }])
  })

  it('refund notice keeps the account policy (no ban lookup) and throws for the payments route', async () => {
    const { sendRefundEmail } = await import('@/lib/email')
    h.prisma.user.findMany.mockResolvedValue([{ email: 'ban@example.test' }])
    h.resendSend.mockResolvedValue({ data: null, error: refusal() })
    await expect(sendRefundEmail('ban@example.test', 'Ban', 'Walk', 300, 'TRY')).rejects.toThrow(/not verified/)
    expect(h.prisma.user.findMany).not.toHaveBeenCalled()
    expect(rows()).toMatchObject([{ helper: 'sendRefundEmail', recipient: 'ban@example.test' }])
  })

  it('a banned recipient is still skipped: no send, no failure row, no throw', async () => {
    const { sendBroadcastEmail } = await import('@/lib/email')
    h.prisma.user.findMany.mockResolvedValue([{ email: 'ban@example.test' }])
    await expect(sendBroadcastEmail('u1', 'ban@example.test', 'Ban', 'Title', 'Body')).resolves.toBeUndefined()
    expect(h.resendSend).not.toHaveBeenCalled()
    expect(h.prisma.emailFailure.create).not.toHaveBeenCalled()
  })

  it('a thrown SDK error propagates unchanged and is left to the caller', async () => {
    const { sendRsvpConfirmationEmail } = await import('@/lib/email')
    h.resendSend.mockRejectedValue(new Error('fetch failed'))
    await expect(sendRsvpConfirmationEmail('ada@example.test', 'Ada', 'Walk', '2026-09-20', 'Moda', 'e1')).rejects.toThrow('fetch failed')
    expect(h.prisma.emailFailure.create).not.toHaveBeenCalled()
  })

  it('newsletter single send: throws and records on refusal, returns the id on success', async () => {
    const { sendNewsletterEmail } = await import('@/lib/email')
    await expect(sendNewsletterEmail('u1', 'ada@example.test', 'Ada', 'S', '<p>x</p>', 'test')).resolves.toBe('m1')
    h.resendSend.mockResolvedValue({ data: null, error: refusal() })
    await expect(sendNewsletterEmail('u1', 'ada@example.test', 'Ada', 'S', '<p>x</p>', 'test')).rejects.toThrow(/not verified/)
    expect(rows()).toMatchObject([{ helper: 'sendNewsletterEmail' }])
  })

  it('newsletter batch is untouched: a whole-batch error lands in `failed` for the route to record', async () => {
    const { sendNewsletterBatch } = await import('@/lib/email')
    h.batchSend.mockResolvedValue({ data: null, error: refusal() })
    const out = await sendNewsletterBatch(
      [{ id: 'u1', email: 'a@example.test', name: 'A' }, { id: 'u2', email: 'b@example.test', name: 'B' }],
      'Subject', '<p>Hi</p>', 'nl1')
    expect(out.sent).toBe(0)
    expect(out.failed.map(f => f.email)).toEqual(['a@example.test', 'b@example.test'])
    expect(h.prisma.emailFailure.create).not.toHaveBeenCalled()
  })

  it('every send helper goes through send() under its own name; the throw list is exactly the reporting callers', () => {
    const src    = read('lib/email.ts')
    expect(src).not.toMatch(/getResend\([^)]*\)\.emails\.send\(/)
    const chunks = src.split(/^export async function /m).slice(1)
    const helpers = chunks
      .map(c => ({ name: c.match(/^(\w+)/)![1], body: c }))
      .filter(c => c.name.startsWith('send') && c.name !== 'sendNewsletterBatch')
    expect(helpers.length).toBeGreaterThan(35)
    for (const { name, body } of helpers) expect(body, name).toContain(`send('${name}',`)
    const throwing = helpers.filter(c => /throwOnError: true/.test(c.body)).map(c => c.name).sort()
    expect(throwing).toEqual([
      'sendBroadcastEmail', 'sendCityLaunchEmail', 'sendConfirmEmailChange', 'sendEventReminderEmail', 'sendFinishRegistrationEmail',
      'sendFirstEventNudgeEmail', 'sendLoginNudgeEmail', 'sendNewsletterEmail', 'sendNoShowEmail', 'sendRefundEmail',
    ])
    const account = helpers.filter(c => /policy: 'account'/.test(c.body)).map(c => c.name).sort()
    // The email-change pair (2026-09-19): confirming the new address and
    // warning the current one are account mail, like the change notice.
    expect(account).toEqual(['sendConfirmEmailChange', 'sendEmailChangeRequestedNotice', 'sendEmailChangedNotice', 'sendRefundEmail'])
  })
})

// ── b) CSV exports ─────────────────────────────────────────────────────────
describe('b) admin CSV exports neutralise formula cells', () => {
  it('payments: every cell quoted and formula-safe, BOM kept, nine columns', async () => {
    const { paymentsCsv } = await import('@/lib/admin/csvExports')
    const csv = paymentsCsv([{
      createdAt: '2026-09-01T10:00:00.000Z', amount: 250, currency: 'TRY', status: 'paid', method: 'cash',
      notes: '+cmd|calc\nline two',
      user:  { name: '=HYPERLINK("http://evil","x")', email: '-x@example.test' },
      event: { title: '@SUM(A1)' },
    }])
    expect(csv.startsWith('﻿"Date","Member name","Email","Event","Amount","Currency","Status","Method","Notes"\n')).toBe(true)
    const line = csv.split('\n')[1]
    expect(line).toBe(`"2026-09-01T10:00:00.000Z","'=HYPERLINK(""http://evil"",""x"")","'-x@example.test","'@SUM(A1)","250","TRY","paid","cash","'+cmd|calc line two"`)
  })

  it('members: formula names neutralised, suspended status from the page\'s rule', async () => {
    const { membersCsv } = await import('@/lib/admin/csvExports')
    const csv = membersCsv([{
      name: '=cmd|\' /C calc\'!A0', email: 'a@example.test', role: 'member', status: 'approved',
      warningCount: 2, nationality: '@TR', joinedAt: '2026-01-05T00:00:00.000Z', lastActive: null, suspendedUntil: 'x',
    }], () => true)
    const [header, line] = csv.split('\n')
    expect(header).toBe('"Name","Email","Role","Status","Warnings","Nationality","Joined","Last Active"')
    expect(line.startsWith(`"'=cmd|' /C calc'!A0","a@example.test","member","suspended","2","'@TR","`)).toBe(true)
    expect(line.endsWith('""')).toBe(true)
  })

  it('pro-waitlist: header now quoted too, embedded quotes doubled, tab/CR leads caught', async () => {
    const { proWaitlistCsv } = await import('@/lib/admin/csvExports')
    const csv = proWaitlistCsv([{
      position: 3, isFounder: true, name: 'Ayşe "Ace" Demir', email: 'ayse@example.test',
      industry: '\t=1+1', role: null, status: 'waitlisted', createdAt: '2026-09-01T00:00:00.000Z',
    }])
    expect(csv).toBe(
      '"position","founder","name","email","industry","role","status","createdAt"\n' +
      `"3","yes","Ayşe ""Ace"" Demir","ayse@example.test","'\t=1+1","","waitlisted","2026-09-01T00:00:00.000Z"`,
    )
  })

  it('the three pages build through the helpers, with no hand-rolled escaping left', () => {
    const payments = read('app/admin/payments/page.tsx')
    // The export now fetches every matching row from the server first.
    expect(payments).toContain('const csv  = paymentsCsv(rows)')
    expect(payments).not.toContain('const escape = (v: string)')
    const users = read('app/admin/users/page.tsx')
    expect(users).toContain('membersCsv(targets, isSuspended)')
    expect(users).toContain('membersCsv(visible, isSuspended)')
    expect(users).not.toContain('.replace(/"/g, \'""\')')
    const waitlist = read('app/admin/pro-waitlist/page.tsx')
    expect(waitlist).toContain('proWaitlistCsv(data.entries)')
    expect(waitlist).not.toContain('csvEscape')
    for (const src of [payments, users, waitlist]) expect(src).not.toMatch(/\.join\(','\)/)
  })
})

// ── c) Sidebar badges ──────────────────────────────────────────────────────
describe('c) the Sidebar shares the Topbar\'s moderation counts', () => {
  it('reads useModCounts with the same enabled rule, and runs no poll of its own', () => {
    const sidebar = read('components/admin/Sidebar.tsx')
    expect(sidebar).toMatch(/import \{ useModCounts \} from '@\/hooks\/useModCounts'/)
    expect(sidebar).toMatch(/const isMod\s+= role === 'moderator' \|\| role === 'admin'/)
    expect(sidebar).toMatch(/const modCounts = useModCounts\(isMod\)/)
    expect(sidebar).not.toMatch(/setInterval/)
    expect(sidebar).not.toMatch(/api\/admin\/mod-stats/)
    expect(sidebar).toMatch(/return modCounts\?\.pendingApplications \?\? 0/)
    expect(sidebar).toMatch(/return modCounts\?\.pendingReports\s+\?\? 0/)
    // A mismatched `enabled` would clear the shared counts under the Topbar.
    expect(read('components/admin/Topbar.tsx')).toMatch(/const isMod\s+= user\?\.role === 'moderator' \|\| user\?\.role === 'admin'/)
  })
})
