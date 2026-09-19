import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 28 refusals in one day, every one a 429: the reminder sweep and the
// review-request sweep each paced themselves and neither knew about the
// other, nor about the standing sweep on the same hour. Pacing belongs at the
// one place every helper passes through.

const sendMock = vi.fn()
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock } } }))
vi.mock('@/lib/prisma', () => ({ prisma: { emailFailure: { create: vi.fn(async () => ({})) } } }))

const RATE_LIMIT = { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY ??= 're_test_key'
})
afterEach(() => vi.useRealTimers())

describe('a 429 is retried, not recorded as a failure', () => {
  it('retries a rate-limited send and reports success when it lands', async () => {
    const { sendVerificationEmail } = await import('@/lib/email')
    sendMock
      .mockResolvedValueOnce({ error: RATE_LIMIT })
      .mockResolvedValueOnce({ data: { id: 'e1' }, error: null })
    await sendVerificationEmail('a@x.com', 'A', 'tok')
    // Asked twice, and the member got their mail.
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the backoff list and records the failure once', async () => {
    const { sendVerificationEmail } = await import('@/lib/email')
    const { prisma } = await import('@/lib/prisma')
    sendMock.mockResolvedValue({ error: RATE_LIMIT })
    await sendVerificationEmail('b@x.com', 'B', 'tok')
    // One initial attempt plus the three backoffs.
    expect(sendMock).toHaveBeenCalledTimes(4)
    expect((prisma as { emailFailure: { create: ReturnType<typeof vi.fn> } }).emailFailure.create).toHaveBeenCalledTimes(1)
  })

  it('does not retry a refusal that will refuse again', async () => {
    const { sendVerificationEmail } = await import('@/lib/email')
    sendMock.mockResolvedValue({ error: { statusCode: 422, name: 'validation_error', message: 'bad address' } })
    await sendVerificationEmail('nope', 'C', 'tok')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
