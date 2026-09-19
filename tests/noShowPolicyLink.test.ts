import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NO_SHOW_POLICY_PATH } from '@/lib/noShowPolicy'

// A member who gets a card lands on /no-show, which shows their own standing
// and never states the rules. Until the policy article existed there was
// nowhere to send them; now there is, and every email that tells someone they
// missed an event has to carry the link. This is the guard: it failed on the
// unfixed code (no link in any of the three) before the line was added.

const sent: { subject: string; html: string }[] = []
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async (m: { subject: string; html: string }) => { sent.push(m); return { data: null, error: null } } }
  },
}))
// lib/email's recipient guard reads the user table; nobody here is banned.
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: async () => [] } } }))
vi.mock('@/lib/unsubscribe', () => ({
  unsubscribeUrl:         () => 'https://example.test/unsub',
  oneClickUnsubscribeUrl: () => 'https://example.test/unsub-1c',
}))

process.env.RESEND_API_KEY = 'test-key'

const { sendNoShowRecordedEmail, sendAttendanceCheckEmail, sendNoShowEmail } = await import('@/lib/email')

beforeEach(() => { sent.length = 0 })

describe('no-show emails link to the policy article', () => {
  // v1's yellow and red card emails carried this; standing's two do the same
  // job and did NOT, so the rule had quietly stopped applying to every email
  // a member actually receives about an absence.
  it('the recorded-absence email', async () => {
    await sendNoShowRecordedEmail('a@example.test', 'Ada Lovelace', 'Coffee Morning', '☕', 'defaulted')
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain(NO_SHOW_POLICY_PATH)
  })

  it('the "you weren\u2019t checked in" warning — a member\u2019s first contact with the rules', async () => {
    await sendAttendanceCheckEmail('a@example.test', 'Ada Lovelace', 'Coffee Morning', '☕', 'e1')
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain(NO_SHOW_POLICY_PATH)
  })

  // The manual "Notify no-shows" button a host presses by hand. Same message
  // to the member, so the same obligation to explain what follows.
  it('the host-sent notify email', async () => {
    await sendNoShowEmail('u1', 'a@example.test', 'Ada Lovelace', 'Coffee Morning', '☕', 'e1')
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain(NO_SHOW_POLICY_PATH)
  })
})
