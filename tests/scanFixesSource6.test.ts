import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { matchesTimeFilter, statusBadge } from '@/lib/hangoutTime'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('payment deletion', () => {
  it('commits the log row with the delete and audits afterwards', () => {
    const src = read('app/api/admin/payments/route.ts')
    expect(src).toMatch(/prisma\.\$transaction\(\[\s*prisma\.paymentLog\.create/)
    expect(src.indexOf("'payment.delete'")).toBeGreaterThan(src.indexOf('prisma.payment.delete({ where: { id } })'))
  })
})

describe('admin handlers surface a refused request', () => {
  it.each([
    ['app/admin/users/[id]/page.tsx', 5],
    ['app/admin/events/[id]/participants/page.tsx', 5],
    ['app/admin/moderation/page.tsx', 3],
  ])('%s calls toastApiError at least %i times', (file, n) => {
    expect((read(file).match(/toastApiError\(res,/g) ?? []).length).toBeGreaterThanOrEqual(n)
  })
})

describe('client city cache', () => {
  it('is reset on login and logout', () => {
    const ctx = read('contexts/AuthContext.tsx')
    expect(ctx).toMatch(/async function logout\(\) \{[\s\S]*?resetCurrentCity\(\)/)
    expect(ctx).toMatch(/function login\(u: AppUser\) \{\s*resetCurrentCity\(\)/)
  })
})

describe('push prompt', () => {
  const src = read('components/PushPermission.tsx')
  it('remembers "Not now" and re-syncs at most daily, with guarded storage', () => {
    expect(src).toMatch(/function handleDismiss\(\) \{\s*writeStamp\(DISMISS_KEY\)/)
    expect(src).toMatch(/Date\.now\(\) - readStamp\(SYNCED_KEY\) > RESYNC_AFTER/)
    expect(src).toMatch(/try \{ return Number\(localStorage\.getItem/)
  })
})

describe('stored notification links', () => {
  it.each(['components/NotificationBell.tsx', 'app/(member)/notifications/page.tsx'])('%s renders them through Link, not a raw anchor', (file) => {
    const src = read(file)
    expect(src).not.toMatch(/<a\s+href=\{n\.link\}/)
    expect(src).toMatch(/<Link\s+href=\{n\.link\}/)
  })
})

describe('hangout time maths follow the viewed city', () => {
  it('matchesTimeFilter and statusBadge take a zone and use it', () => {
    // 2026-07-05 18:30Z: 21:30 in Istanbul (tonight), 14:30 in New York (today, not tonight).
    const h = { startsAt: '2026-07-05T18:30:00Z', endsAt: '2026-07-05T20:30:00Z' }
    const now = new Date('2026-07-05T10:00:00Z')
    expect(matchesTimeFilter(h, 'tonight', now, 'Europe/Istanbul')).toBe(true)
    expect(matchesTimeFilter(h, 'tonight', now, 'America/New_York')).toBe(false)
    expect(statusBadge(h.startsAt, h.endsAt, now, 'Europe/Istanbul')?.label).toBe('Tonight')
    expect(statusBadge(h.startsAt, h.endsAt, now, 'America/New_York')).toBeNull()
  })
  it('the page passes the city zone and re-derives composer defaults when it resolves', () => {
    const src = read('app/(member)/hangouts/page.tsx')
    expect(src).toMatch(/matchesTimeFilter\(h, timeFilter, new Date\(\), tz\)/)
    expect(src).toMatch(/statusBadge\(h\.startsAt, h\.endsAt, new Date\(\), tz\)/)
    expect(src).toMatch(/setStartsAt\(prev => prev === appliedDefaults\.current\.s \? s : prev\)/)
  })
  it('lib/hangoutTime no longer pins the default city', () => {
    expect(read('lib/hangoutTime.ts')).not.toMatch(/const TZ = DEFAULT_TZ|istanbulDay/)
  })
})

describe('hangout sweepers', () => {
  it('only sweep-hangouts expires hangouts (it sends the recap)', () => {
    expect(read('app/api/admin/cron/reminders/route.ts')).not.toMatch(/prisma\.hangout\.updateMany\(\{\s*where: \{ endsAt: \{ lt: now \}, status: 'active' \}/)
    expect(read('app/api/cron/sweep-hangouts/route.ts')).toMatch(/'expired'/)
  })
  it('hangout edit and cancel scope the staff override to the city', () => {
    const src = read('app/api/hangouts/[id]/route.ts')
    expect(src.match(/canActInCity\(session, hangout\.cityId\)/g)).toHaveLength(2)
    expect(src).not.toContain('isAdminOrModerator')
  })
})

describe('scheduled newsletter sweep', () => {
  const src = read('app/api/cron/sweep-newsletters/route.ts')
  it('marks a failed or stuck issue instead of stranding it in sending', () => {
    expect(src).toMatch(/status: 'sending', scheduledFor: \{ lt: new Date\(Date\.now\(\) - STUCK_AFTER_MS\) \}/)
    expect(src).toMatch(/catch \(err\) \{[\s\S]*?data: \{ status: 'failed' \}/)
    expect(src).toMatch(/status: sent > 0 \? 'sent' : 'failed'/)
  })
})
