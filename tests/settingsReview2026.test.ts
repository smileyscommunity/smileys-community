import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The settings review (2026-09-20). A moderator could move their own
// moderation powers to another city from a member-facing setting; signing a
// device out left it receiving push notifications; the marketing toggle
// showed ON to members who had unsubscribed; quiet hours muted nothing that
// actually buzzes at 3am; deleting an account asked for less than changing
// an email; and a reset link outlived the password change our own warning
// emails tell people to make. These pin the fixes.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
    city: { findUnique: vi.fn() },
    cityRelationship: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))
vi.mock('@/lib/totpCrypto', () => ({ decryptTotpSecret: vi.fn(() => 'secret') }))
vi.mock('otplib/functional', () => ({ verifySync: vi.fn(() => ({ valid: true })) }))

import { prisma } from '@/lib/prisma'
import { setHomeCity } from '@/lib/cityMembership'
import { totpReauth } from '@/lib/totpReauth'

describe('moving home city', () => {
  beforeEach(() => vi.clearAllMocks())
  const live = { id: 'c-ank', slug: 'ankara', name: 'Ankara', status: 'live' }

  it('a staff account can\'t move itself — User.cityId is the moderator scope', async () => {
    ;(prisma.city.findUnique as never as ReturnType<typeof vi.fn>).mockResolvedValue(live)
    for (const role of ['moderator', 'admin', 'host']) {
      ;(prisma.user.findUnique as never as ReturnType<typeof vi.fn>).mockResolvedValue({ cityId: 'c-ist', status: 'approved', role })
      const res = await setHomeCity('u1', 'ankara')
      expect(res.ok, role).toBe(false)
    }
  })

  it('an admin can still move a staff account — otherwise nobody could', async () => {
    ;(prisma.city.findUnique as never as ReturnType<typeof vi.fn>).mockResolvedValue(live)
    ;(prisma.user.findUnique as never as ReturnType<typeof vi.fn>).mockResolvedValue({ cityId: 'c-ist', status: 'approved', role: 'moderator' })
    const res = await setHomeCity('u1', 'ankara', { byAdmin: true })
    expect(res.ok).toBe(true)
    const admin = src('app/api/admin/users/[id]/route.ts')
    expect(admin).toContain("const moveTo = 'homeCitySlug' in body ? String(body.homeCitySlug ?? '').trim() : null")
    // The move runs after every other field is accepted, or a rejected
    // neighbourhood would leave the member moved and the save failed.
    expect(admin.indexOf('await setHomeCity(id, moveTo')).toBeGreaterThan(admin.indexOf('normalizeNeighborhoodInput(cityForNeighborhood'))
    expect(admin).toContain("if (!adminPrivilege) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })")
    // And there's a control for it, not just an endpoint.
    expect(src('app/admin/users/[id]/page.tsx')).toContain('id="ae-home-city"')
  })

  it('the route leaves a trail, clears the browsed-city cookie and is bounded', () => {
    const route = src('app/api/me/cities/route.ts')
    expect(route).toContain("'user.home_city_changed'")
    // Set empty with the same attributes — a bare delete no-ops on iOS.
    expect(route).toContain("res.cookies.set(VIEW_CITY_COOKIE, '', {")
    expect(route).toContain('rateLimit(`home-city:${session.id}`')
    // The page tells the member their neighbourhood is gone.
    expect(route).toContain('neighborhoodCleared: !result.alreadyHome,')
  })
})

describe('a second proof for the three account-takeover operations', () => {
  beforeEach(() => vi.clearAllMocks())
  const enrolled = { id: 'u1', totpEnabled: true, totpSecret: 'enc' }

  it('an account without 2FA is unaffected', async () => {
    expect(await totpReauth({ id: 'u1', totpEnabled: false, totpSecret: null }, undefined)).toBeNull()
  })

  it('an enrolled account is asked for a code, and a good one is claimed once', async () => {
    const missing = await totpReauth(enrolled, undefined)
    expect(missing?.status).toBe(400)
    expect(await missing!.json()).toEqual({ error: 'code_required' })

    expect(await totpReauth(enrolled, '123456')).toBeNull()
    ;(prisma.user.updateMany as never as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0 })
    const reused = await totpReauth(enrolled, '123456')
    expect(await reused!.json()).toEqual({ error: 'This code was already used — wait for the next one.' })
  })

  it('deleting the account and changing the password ask for it too', () => {
    for (const r of ['delete-account', 'change-password', 'update-email']) {
      expect(src(`app/api/auth/${r}/route.ts`), r).toContain('await totpReauth(user, code)')
    }
  })
})

describe('signing out a device', () => {
  it('takes that device\'s push subscription with it', () => {
    expect(src('app/api/push/subscribe/route.ts')).toContain('sessionId: session.sessionId ?? null')
    expect(src('app/api/auth/sessions/[id]/route.ts'))
      .toContain('prisma.pushSubscription.deleteMany({ where: { userId: session.id, sessionId: id } })')
  })

  it('"everywhere else" reaches sessions too old to have a row, and keeps this browser', () => {
    const s = src('app/api/auth/sessions/route.ts')
    expect(s).toContain('export async function POST()')
    expect(s).toContain('where: { userId: session.id, revokedAt: null, ...(keep ? { id: { not: keep } } : {}) }')
    expect(s).toContain('tokenVersion: { increment: 1 }')
    expect(s).toContain('reuseSessionId: keep')
  })

  it('a password change ends every device, its pushes and every outstanding link', () => {
    const s = src('app/api/auth/change-password/route.ts')
    expect(s).toContain('await tx.pushSubscription.deleteMany({ where: { userId: session.id } })')
    expect(s).toContain('await tx.passwordResetToken.deleteMany({ where: { userId: session.id } })')
    // Only the pending email change — not the signup verification link.
    expect(s).toContain("await tx.emailVerificationToken.deleteMany({ where: { userId: session.id, newEmail: { not: null } } })")
    // Step-up survives the new session row (the reuse path only slid expiry).
    expect(s).toContain('totpVerified: session.totpVerified ?? false,')
    expect(src('lib/session.ts')).toContain('...(opts.totpVerified !== undefined ? { totpVerified: opts.totpVerified } : {})')
  })

  it('an email change kills reset links issued to the old address', () => {
    expect(src('app/api/auth/verify-email/route.ts')).toContain('await tx.passwordResetToken.deleteMany({ where: { userId } })')
  })
})

describe('what the settings page is told', () => {
  it('the marketing toggle reads the saved value', () => {
    const me = src('app/api/auth/me/route.ts')
    expect(me).toContain('emailMarketing: true,')
    expect(me).toContain('emailMarketing: updated.emailMarketing,')
  })

  it('a pending email change can be seen and cancelled', () => {
    const s = src('app/api/auth/update-email/route.ts')
    expect(s).toContain('export async function GET()')
    expect(s).toContain('export async function DELETE()')
    // And a malformed address is refused before it spends an attempt.
    expect(s).toContain("return NextResponse.json({ error: \"That doesn't look like an email address\" }, { status: 400 })")
  })

  it('quiet hours with no gap are refused rather than silently doing nothing', () => {
    expect(src('app/api/notifications/preferences/route.ts'))
      .toContain("return NextResponse.json({ error: 'Quiet hours need a start and a different end' }, { status: 400 })")
  })
})

describe('quiet hours', () => {
  it('are read for every push, not only the types with a preference key', () => {
    const s = src('lib/notify.ts')
    expect(s).not.toContain("if (prefKey !== undefined && prefKey !== null) {\n      const prefs")
    expect(s).toContain('      : await prisma.notificationPreference.findUnique({ where: { userId } })\n    if (prefs) {')
    // Except the few that are only useful in the next few minutes.
    expect(s).toContain('export const QUIET_HOURS_EXEMPT')
    expect(s).toContain("!QUIET_HOURS_EXEMPT.has(type)")
    expect(s).toContain('if (prefKey !== undefined && prefKey !== null && !prefs[prefKey]) return true')
  })

  it('the one fan-out that pushes without a notification row honours them too', () => {
    expect(src('lib/notify.ts')).toContain('export async function pushablePushIds(')
    expect(src('app/api/cron/sweep-cup-reminders/route.ts'))
      .toContain("await pushablePushIds(candidates.map(u => u.id), 'cup_reminder')")
  })
})

describe('deleting your account', () => {
  const s = src('app/api/auth/delete-account/route.ts')

  it('calls off the events they were hosting and tells the people who were going', () => {
    expect(s).toContain("status: { in: ['published', 'pending', 'draft', 'flagged', 'postponed'] },")
    expect(s).toContain("data:  { status: 'cancelled', cancelledAt: stamp, cancelReason: 'The host left Smileys' },")
    // Only events that haven't started — tonight's finished event is not
    // "upcoming" just because the date is today.
    expect(s).toContain('if (eventStartsAt(e, tz).getTime() > Date.now()) hostedEvents.push(e)')
    // And cancelling means what it means everywhere else: seats released,
    // waitlist cleared, counter re-derived, the email sent.
    expect(s).toContain("data:  { status: 'removed', cancelledAt: stamp, cancelledBy: 'admin' },")
    expect(s).toContain('await tx.waitlistEntry.deleteMany({ where: { eventId: { in: eventIds } } })')
    expect(s).toContain('recomputeSpotsLeft(e.id, e.totalSpots)')
    expect(s).toContain('sendEventCancelledEmail(a.user.email')
    expect(s).toContain("createNotification(a.userId, 'event_cancelled'")
    expect(s).toContain('notifyCityStaff(e.cityId')
  })

  it('scrubs the work details and any staff role', () => {
    for (const f of ['industry:           null,', 'professionalRole:   null,', 'professionalStatus: null,', "role:             'member',"]) {
      expect(s).toContain(f)
    }
  })
})
