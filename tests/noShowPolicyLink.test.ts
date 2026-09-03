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
vi.mock('@/lib/unsubscribe', () => ({
  unsubscribeUrl:         () => 'https://example.test/unsub',
  oneClickUnsubscribeUrl: () => 'https://example.test/unsub-1c',
}))

process.env.RESEND_API_KEY = 'test-key'

const { sendYellowCardEmail, sendRedCardEmail, sendNoShowEmail } = await import('@/lib/email')

beforeEach(() => { sent.length = 0 })

describe('no-show emails link to the policy article', () => {
  it('yellow card', async () => {
    await sendYellowCardEmail('u1', 'a@example.test', 'Ada Lovelace', 'Coffee Morning', '☕')
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain(NO_SHOW_POLICY_PATH)
  })

  it('red card', async () => {
    await sendRedCardEmail('u1', 'a@example.test', 'Ada Lovelace', 'Coffee Morning', '☕', {
      appealDeadlineAt:    new Date('2026-09-05T12:00:00Z'),
      restrictionStartsAt: new Date('2026-09-05T12:00:00Z'),
      restrictionEndsAt:   new Date('2026-10-05T12:00:00Z'),
    })
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
