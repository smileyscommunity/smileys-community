import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('4 push subscribe', () => {
  const src = read('app/api/push/subscribe/route.ts')
  it('accepts only known push services, no credentials, no port; budgets and caps rows', () => {
    expect(src).toMatch(/const PUSH_HOSTS\s*= \['fcm\.googleapis\.com', 'web\.push\.apple\.com', 'updates\.push\.services\.mozilla\.com'\]/)
    expect(src).toMatch(/u\.protocol !== 'https:' \|\| u\.username \|\| u\.password \|\| u\.port/)
    expect(src).toMatch(/rateLimit\(`push-sub:\$\{session\.id\}`, 10, 60 \* 60_000\)/)
    expect(src).toMatch(/skip: MAX_SUBSCRIPTIONS_PER_USER/)
  })
})

describe('5 hangout join', () => {
  it('is rate-limited and the host can mute it', () => {
    expect(read('app/api/hangouts/[id]/join/route.ts')).toMatch(/rateLimit\(`hangout-join:\$\{session\.id\}`, 10, 60_000\)/)
    expect(read('lib/notify.ts')).toMatch(/hangout_join:\s*'joinedEvents'/)
  })
})

describe('6 cascaded history is snapshotted into the audit row', () => {
  it('user removal and self-deletion keep reports, cards and notes', () => {
    expect(read('app/api/admin/users/[id]/route.ts')).toMatch(/const retained = await snapshotUserHistory\(id\)[\s\S]*?payments: paymentSummary, retained \}/)
    expect(read('app/api/auth/delete-account/route.ts')).toMatch(/const retained = await snapshotUserHistory\(id\)[\s\S]*?fingerprint: user\.lastFingerprint, retained \}/)
  })
  it('directory and campaign deletion keep their reports, claims and ledger', () => {
    expect(read('app/api/admin/directory/route.ts')).toMatch(/retained: \{ reports, claims \}/)
    expect(read('app/api/admin/campaigns/route.ts')).toMatch(/retained: \{ sponsors, prizes, donations \}/)
  })
})

describe('7 photo galleries', () => {
  it('the event page, the recap and club galleries follow the attendee gate', () => {
    expect(read('app/events/[id]/page.tsx')).toMatch(/photos=\{canSeeInside \? eventPhotos : \[\]\}/)
    const recap = read('app/(member)/events/[id]/recap/page.tsx')
    expect(recap).toMatch(/const today = await todayInCity\(event\.cityId\)/)
    expect(recap).toMatch(/if \(!staff && event\.hostId !== session\.id && !cohost && myRow\?\.status !== 'approved'\)/)
    expect(read('app/api/clubs/[slug]/photos/route.ts')).toMatch(/author:\s*\{ id: '', name: p\.event\.title/)
  })
})

describe('8 newsletter sweep', () => {
  const src = read('app/api/cron/sweep-newsletters/route.ts')
  it('finds stuck rows by claim time and the digest fails like the others', () => {
    expect(src).toMatch(/status: 'sending', sentAt: \{ lt: new Date\(Date\.now\(\) - STUCK_AFTER_MS\) \}/)
    expect(src).toMatch(/data:\s*\{ status: sent > 0 \? 'sent' : 'failed', recipientCount: sent, sentAt: new Date\(\) \}/)
    expect(src).toMatch(/helper: 'sendNewsletterBatch \(auto-weekly\)'/)
  })
})

describe('9 sweeps dedupe on claims a member cannot clear', () => {
  it('claimOnce exists and the six ledgers use it', () => {
    expect(read('lib/rateLimit.ts')).toMatch(/export function claimOnce\(key: string, windowMs: number\)/)
    const rem = read('app/api/admin/cron/reminders/route.ts')
    for (const k of ['reminder-24h:', 'reminder-2h:', 'connsug:', 'review:', 'listing-expiry:']) expect(rem).toContain(`claimOnce(\`${k}`)
    expect(read('app/api/cron/sweep-review-nudges/route.ts')).toMatch(/claimOnce\(`dir-review-nudge:\$\{userId\}`/)
    expect(read('app/api/cron/sweep-nps/route.ts')).toMatch(/claimOnce\(`nps:\$\{uid\}:\$\{period\}`/)
  })
})

describe('10 sweep wrappers', () => {
  const wrappers = readdirSync('scripts').filter(f => /^sweep-.*\.sh$/.test(f))
  it.each(wrappers)('%s takes a lock and logs a non-2xx', (f) => {
    const src = read(`scripts/${f}`)
    expect(src).toMatch(/flock -n 9 \|\|/)
    if (src.includes('curl ')) {
      expect(src).toMatch(/-w '%\{http_code\}'/)
      expect(src).toMatch(/FAILED HTTP \$CODE/)
      expect(src).not.toMatch(/"\$ENDPOINT" \|\| true/)
    }
  })
  it('deploy registers log rotation for the sweep logs', () => {
    expect(read('deploy.sh')).toMatch(/\/etc\/logrotate\.d\/smileys-sweeps/)
  })
})
