import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { rateLimit, claimOnce, getIp } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'

// lib/rateLimit is the DB-backed counter behind every throttle and every
// sweep's "sent once" ledger. The SQL upsert is the database's job; what
// lives in TypeScript is the verdict (count vs limit), the parameters handed
// to the query, and the client-IP extraction that feeds most keys.

const q = (prisma as any).$queryRaw as ReturnType<typeof vi.fn>
const countIs = (count: unknown) => q.mockResolvedValueOnce([{ count }])

// The tagged template call: (strings, ...values).
const lastValues = () => q.mock.calls.at(-1)!.slice(1)
const lastSql = () => (q.mock.calls.at(-1)![0] as TemplateStringsArray).join('?')

beforeEach(() => {
  q.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it('allows while the returned count is at or under the limit, refuses above it', async () => {
    countIs(1);  expect(await rateLimit('k', 3, 60_000)).toBe(true)
    countIs(3);  expect(await rateLimit('k', 3, 60_000)).toBe(true)
    countIs(4);  expect(await rateLimit('k', 3, 60_000)).toBe(false)
  })

  it('coerces a bigint or string count before comparing', async () => {
    countIs(BigInt(5)); expect(await rateLimit('k', 5, 1000)).toBe(true)
    countIs(BigInt(6)); expect(await rateLimit('k', 5, 1000)).toBe(false)
    countIs('2');       expect(await rateLimit('k', 2, 1000)).toBe(true)
  })

  it('passes the key and resetAt as bound parameters, not spliced into the SQL text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-13T10:00:00Z'))
    countIs(1)
    const key = `rsvp:u1'; DROP TABLE rate_limits; --`
    await rateLimit(key, 5, 60_000)

    const values = lastValues()
    expect(values[0]).toBe(key)
    const resetAt = values[1] as Date
    expect(resetAt).toBeInstanceOf(Date)
    expect(resetAt.getTime()).toBe(new Date('2026-09-13T10:01:00Z').getTime())
    expect(lastSql()).not.toContain('DROP TABLE')
    expect(lastSql()).toContain('rate_limits')
  })
})

describe('claimOnce', () => {
  it('is a limit-1 rateLimit: the first claim wins, a second in the window loses', async () => {
    countIs(1); expect(await claimOnce('sweep:x', 3_600_000)).toBe(true)
    countIs(2); expect(await claimOnce('sweep:x', 3_600_000)).toBe(false)
    expect(lastValues()[0]).toBe('sweep:x')
  })

  it('uses the window it is given for resetAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    countIs(1)
    await claimOnce('sweep:y', 86_400_000)
    expect((lastValues()[1] as Date).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })
})

describe('getIp', () => {
  // A plain header bag: the real Headers class rejects CR/LF outright, which
  // would stop the injection cases from ever reaching normalizeIp.
  const reqWith = (h: Record<string, string>) =>
    ({ headers: { get: (k: string) => h[k.toLowerCase()] ?? null } }) as unknown as Request

  it('prefers x-real-ip over x-forwarded-for', () => {
    expect(getIp(reqWith({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.9')
  })

  it('falls back to the LAST x-forwarded-for hop (the one the proxy appended)', () => {
    expect(getIp(reqWith({ 'x-forwarded-for': '1.1.1.1, 10.0.0.2, 198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('falls back to x-forwarded-for when x-real-ip is malformed', () => {
    expect(getIp(reqWith({ 'x-real-ip': '1.2.3.4 evil', 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('does not fall back to an earlier, client-supplied hop when the last one is bad', () => {
    expect(getIp(reqWith({ 'x-forwarded-for': '8.8.8.8, bad value' }))).toBe('unknown')
  })

  it('rejects CRLF, interior spaces and semicolons', () => {
    expect(getIp(reqWith({ 'x-real-ip': '1.2.3.4\r\nX-Evil: 1' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-real-ip': '1.2.3.4\n' + '5.6.7.8' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-real-ip': '1.2.3.4 5.6.7.8' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-real-ip': '1.2.3.4;rm' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2\r\nSet-Cookie: a=b' }))).toBe('unknown')
  })

  it('trims surrounding whitespace and strips IPv6 brackets', () => {
    expect(getIp(reqWith({ 'x-real-ip': '  203.0.113.9  ' }))).toBe('203.0.113.9')
    expect(getIp(reqWith({ 'x-real-ip': '[2001:db8::1]' }))).toBe('2001:db8::1')
    expect(getIp(reqWith({ 'x-forwarded-for': '1.1.1.1, ::1' }))).toBe('::1')
  })

  it('rejects values longer than 45 characters', () => {
    expect(getIp(reqWith({ 'x-real-ip': '1'.repeat(46) }))).toBe('unknown')
    const longest = '0000:0000:0000:0000:0000:ffff:255.255.255.255'   // 45 chars, a valid IPv6
    expect(getIp(reqWith({ 'x-real-ip': longest }))).toBe(longest)
  })

  it('returns "unknown" with no usable header at all', () => {
    expect(getIp(reqWith({}))).toBe('unknown')
    expect(getIp(reqWith({ 'x-real-ip': '' }))).toBe('unknown')
  })
})
