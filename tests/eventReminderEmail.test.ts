import { describe, it, expect, vi, beforeEach } from 'vitest'

// The event reminder email in its two forms (2026-09-26): the day-before one
// the hourly sweep and the admin "remind attendees" button send, and the
// same-day "starting soon" one — its own subject and line, so a member who
// gets both doesn't read the second as a repeat.

const h = vi.hoisted(() => ({
  prisma: { user: { findMany: vi.fn() } },
  resendSend: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.resendSend }
    batch  = { send: vi.fn() }
  },
}))
vi.mock('@/lib/unsubscribe', () => ({
  unsubscribeUrl:         () => 'https://example.test/unsub',
  oneClickUnsubscribeUrl: () => 'https://example.test/unsub-1c',
}))

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test'
  h.prisma.user.findMany.mockReset().mockResolvedValue([])
  h.resendSend.mockReset().mockResolvedValue({ data: { id: 'm1' }, error: null })
})

async function sent(opts: Parameters<typeof import('@/lib/email')['sendEventReminderEmail']>[7]) {
  const { sendEventReminderEmail } = await import('@/lib/email')
  await sendEventReminderEmail('ok@example.test', 'Ada Lovelace', 'Coffee Break', '☕', '2026-09-29', 'Fenerbahçe', 'e1', opts)
  expect(h.resendSend).toHaveBeenCalledTimes(1)
  return h.resendSend.mock.calls[0][0] as { subject: string; html: string }
}

describe('sendEventReminderEmail', () => {
  it('day-before: the familiar subject, with the start time beside the date', async () => {
    const m = await sent({ time: '19:00' })
    expect(m.subject).toBe('Reminder: Coffee Break ☕ is coming up!')
    expect(m.html).toContain('· 19:00')
    expect(m.html).toContain('is coming up soon')
  })

  it('starting soon: names the lead in the subject and the body', async () => {
    const m = await sent({ time: '19:00', startsInHours: 6.2 })
    expect(m.subject).toBe('Starting soon: Coffee Break ☕, in ~6 hours')
    expect(m.html).toContain('starts in ~6 hours')
  })

  it('starting soon an hour out says "hour", not "hours"', async () => {
    const m = await sent({ startsInHours: 1.2 })
    expect(m.subject).toBe('Starting soon: Coffee Break ☕, in ~1 hour')
  })

  it('the admin button, with no time, still renders', async () => {
    const m = await sent({})
    expect(m.subject).toBe('Reminder: Coffee Break ☕ is coming up!')
    expect(m.html).not.toContain('· undefined')
  })
})
