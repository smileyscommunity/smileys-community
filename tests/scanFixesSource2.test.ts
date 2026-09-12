import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('event discussion lock', () => {
  it('POST and PATCH guards use one rule on the event city\'s calendar', () => {
    const src = read('app/api/events/[id]/messages/route.ts')
    expect(src.match(/todayInTz\(await getCityTz\(event\.cityId\)\) >= discussionLockDay\(event\.date\)/g)).toHaveLength(2)
    expect(src).not.toMatch(/new Date\(event\.date\); lockedAt/)
  })
  it('the composer locks on the same rule and clock', () => {
    const src = read('components/EventMessages.tsx')
    expect(src).toMatch(/todayInTz\(eventTz \?\? DEFAULT_TZ\) >= discussionLockDay\(eventDate\)/)
    expect(read('app/events/[id]/page.tsx')).toContain('<EventMessages eventId={event.id} eventDate={event.date} eventTz={eventTz} />')
  })
})

describe('doors-open broadcast', () => {
  it('is stamped once per event by a claim, not by counting notifications', () => {
    // Superseded 2026-09-13: the notification count raced (host + co-host) and
    // re-armed when a bell was cleared. tests/fourthScanFixes5 pins the claim.
    const src = read('app/api/events/[id]/checkin/route.ts')
    expect(src).toMatch(/claimOnce\(`checkin-started:\$\{eventId\}`/)
    expect(src).not.toMatch(/prisma\.notification\.count/)
  })
})

describe('review eligibility', () => {
  it('is judged on the event city, not the viewer\'s', () => {
    const src = read('app/api/events/[id]/reviews/route.ts')
    expect(src).toMatch(/todayInCity\(event\.cityId\)/)
    expect(src).not.toContain('resolveCityId')
  })
  it('club health uses the city calendar for date-string compares', () => {
    const src = read('lib/clubHealth.ts')
    expect(src).toMatch(/const today = dayInTz\(now, tz\)/)
    expect(src).not.toMatch(/now\.toISOString\(\)\.split\('T'\)\[0\]/)
  })
})

describe('TOTP step claims', () => {
  const claim = /prisma\.user\.updateMany\(\{\s*where: \{ id: [a-z.]+, OR: \[\{ lastUsedTotpStep: null \}, \{ lastUsedTotpStep: \{ lt: currentStep \} \}\] \},\s*data:\s*\{ lastUsedTotpStep: currentStep \},/
  it('email change claims the step atomically', () => {
    expect(read('app/api/auth/update-email/route.ts')).toMatch(claim)
  })
  it('backup-code regeneration claims the step atomically instead of read-then-write', () => {
    const src = read('app/api/auth/2fa/backup-codes/route.ts')
    expect(src).toMatch(claim)
    expect(src).not.toMatch(/currentStep <= user\.lastUsedTotpStep/)
  })
})
