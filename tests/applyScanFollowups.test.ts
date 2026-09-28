import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { retentionWhere, REJECTED_RETENTION_DAYS, DEVICE_DATA_RETENTION_DAYS } from '@/lib/applicationRetention'

// Apply page scan 2026-09-29, items 1–7.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const client = read('app/apply/ApplyClient.tsx')
const route  = read('app/api/apply/route.ts')

describe('1: coming-soon cities can be applied to', () => {
  it('the neighbourhoods API serves coming-soon lists to the application form', () => {
    const api = read('app/api/neighborhoods/route.ts')
    expect(api).toContain("const forApply = req.nextUrl.searchParams.get('for') === 'apply'")
    expect(api).toContain('[CITY_STATUS.Live, CITY_STATUS.Preparing, CITY_STATUS.ComingSoon]')
    expect(read('hooks/useCityNeighborhoods.ts')).toContain("${opts.forApply ? '&for=apply' : ''}")
    expect(client).toContain('useCityNeighborhoodList(targetCitySlug, { forApply: true })')
  })
  it('the field is optional where a city has none; a stale pick is cleared once the list arrives', () => {
    expect(client).toContain('const hoodOptional = hoodsLoaded && neighborhoods.length === 0')
    expect(client).toContain('if (!hoodsLoaded) return')
    expect(route).toContain('neighborhood:z.string().trim().max(200).optional().nullable(),')
    // Items 14/16 refined it: one of the city's own names, required unless the
    // city has none or the applicant doesn't live there yet.
    expect(route).toContain('if (!cleanNeighborhood && !notResident && cityHoods.length > 0) {')
  })
})

describe('2: the cookie choice gates analytics and fingerprinting', () => {
  it('analytics start opted out with nothing persisted until "Accept all"', () => {
    const init = read('instrumentation-client.ts')
    expect(init).toContain('opt_out_capturing_by_default: !consented')
    expect(init).toContain("persistence: consented ? 'localStorage+cookie' : 'memory'")
    expect(init).toContain('disable_session_recording: !consented')
    const banner = read('components/CookieBanner.tsx')
    expect(banner).toContain('posthog.opt_in_capturing()')
    expect(banner).toContain('posthog.opt_out_capturing()')
  })
  it('the form fingerprints only with consent, masks the email line, and sends no nationality or neighbourhood', () => {
    expect(client).toContain('if (hasAnalyticsConsent()) FingerprintJS.load()')
    expect(client).toContain('ph-no-capture')
    const capture = client.slice(client.indexOf("posthog.capture('application_submitted'"), client.indexOf("posthog.capture('application_submitted'") + 300)
    expect(capture).not.toContain('country')
    expect(capture).not.toContain('neighborhood')
  })
})

describe('3: the agreements are real checkboxes', () => {
  it('an input inside each label, focus shown on the styled box', () => {
    expect(client).toContain('<input type="checkbox" className="sr-only peer" checked={agreements[key]}')
    expect(client).toContain('peer-focus-visible:ring-2')
    expect(client).not.toContain('onClick={() => setAgreements(a => ({ ...a, [key]: !a[key] }))}')
  })
})

describe('4: shared networks are flags, not refusals', () => {
  it('no auto-reject, no IP cooldown, device/network blacklist is a flag, rate limit after the captcha', () => {
    expect(route).not.toContain("status: 'rejected', reviewNote: 'Auto-rejected: velocity")
    expect(route).toContain('const manyFromNetwork = ipCount >= 3')
    expect(route).not.toContain("ip         ? { ipAddress: ip }     : null,\n    ].filter(Boolean) as object[]\n    const recentRejection")
    // Item 10 made the identity half a canonical comparison.
    expect(route).toContain('const blacklisted = blacklistIds.some(b =>')
    expect(route).toContain("if (blacklistedDevice) flags.push('device or network on the blacklist')")
    expect(route.indexOf('await verifyTurnstile(')).toBeLessThan(route.indexOf('rateLimit(`apply:${getIp(req)}`'))
    // Old velocity rejections never count (item 10 moved this into the query).
    expect(route).toContain("NOT: { reviewNote: { startsWith: 'Auto-rejected: velocity' } },")
  })
  it('every refusal says how to reach a person', () => {
    expect(route).toContain("const CONTACT = 'If you think this is a mistake, write to info@smileyscommunity.com.'")
    expect(route).not.toContain("{ error: 'This application cannot be accepted.' }")
  })
})

describe('5: third parties and retention', () => {
  it('no IP geolocation call; the AI prompt carries no name or referral code', () => {
    expect(route).not.toContain('ip-api.com')
    const screen = read('app/api/admin/applications/screen/route.ts')
    expect(screen).not.toContain('Name: ${app.fullName}')
    expect(screen).toContain("Referred by a member: ${app.referredBy ? 'yes' : 'no'}")
  })
  it('retention: rejected after 12 months (auto-rejections by creation), device data after 90 days; dry run by default', () => {
    expect(REJECTED_RETENTION_DAYS).toBe(365)
    expect(DEVICE_DATA_RETENTION_DAYS).toBe(90)
    const w = retentionWhere(new Date('2027-10-01T00:00:00Z'))
    expect(w.rejected.status).toBe('rejected')
    expect((w.rejected.OR[1] as { reviewedAt: null }).reviewedAt).toBeNull()
    expect(w.deviceData.OR).toHaveLength(3)
    const job = read('app/api/cron/sweep-application-retention/route.ts')
    expect(job).toContain("const commit = req.nextUrl.searchParams.get('commit') === '1'")
    expect(job).toContain('if (!commit) return NextResponse.json({ dryRun: true')
  })
})

describe('6: the city is right from the first paint and survives a draft', () => {
  it('the page resolves ?city= on the server, case-insensitively', () => {
    const page = read('app/apply/page.tsx')
    expect(page).toContain('const slug = (await searchParams).city?.trim().toLowerCase()')
    expect(page).toContain('return <ApplyClient initialCity={initialCity} />')
    expect(client).toContain('useState(initialCity?.slug ?? DEFAULT_APPLY_CITY.slug)')
  })
  it('the draft keeps its city; step 1 is re-checked at submit; server errors name the field', () => {
    expect(client).toContain('step, targetCitySlug,\n')
    expect(client).toContain("if (!cityParam && typeof d.targetCitySlug === 'string' && d.targetCitySlug) setTargetCitySlug(d.targetCitySlug)")
    expect(client).toContain("showError('A few details on the first step need another look.')")
    expect(route).toContain('`Please check your ${field}.`')
  })
})

describe('7: old drafts and failed uploads', () => {
  it('the restored step is clamped once, never overwritten', () => {
    expect(client).toContain('setStep(Math.min(Math.max(0, Math.floor(d.step)), STEPS.length - 1))')
    expect(client).not.toContain("if (typeof d.step === 'number') setStep(d.step)")
  })
  it('a failed upload takes its preview down', () => {
    expect(client.split("URL.revokeObjectURL(localUrl); setLocalPhoto('')").length - 1).toBe(2)
  })
})

// Items 8–16 (2026-09-29).

import { canonicalEmail, canonicalPhone, isValidTimeZone, ageOn } from '@/lib/applicantIdentity'

describe('8: the copy follows the city', () => {
  it('stage-dependent header, social proof and what-to-expect; no gender-balance promise', () => {
    expect(client).toContain("const cityMature = cityLive && targetCity.maturity === 'self_sustaining'")
    expect(client).toContain('Smileys is opening in {targetCityName} — apply to be one of its founding members.')
    expect(client).toContain('{cityLive && <div className="mt-10 pt-8 border-t border-gray-100">')
    expect(client).not.toContain('gender-balanced by default')
    expect(client).toContain('← Back to Smileys {targetCityName}')
  })
  it('metadata is neutral; open cities are listed first', () => {
    const page = read('app/apply/page.tsx')
    expect(page).not.toContain('most vibrant')
    expect(page).toContain("const title    = cityName ? `Apply to Join Smileys ${cityName}` : 'Apply to Join Smileys'")
    expect(client).toContain("const rank = (st: string) => (st === 'live' ? 0 : st === 'preparing' ? 1 : 2)")
  })
})

describe('9: double opt-in', () => {
  it('a token on create, a confirm route, confirmed-only blocking, no rejection email unconfirmed, no token to staff', () => {
    expect(route).toContain("const confirmToken = randomBytes(24).toString('hex')")
    expect(read('app/api/apply/confirm/route.ts')).toContain("where: { confirmToken: token, emailConfirmedAt: null },")
    expect(route).toContain("const liveApp = emailApps.find(a => a.status !== 'rejected' && (a.emailConfirmedAt || a.status === 'approved'))")
    expect(route).toContain("status: 'rejected', emailConfirmedAt: { not: null },")
    const admin = read('app/api/admin/applications/route.ts')
    expect(admin).toContain('if (application.emailConfirmedAt) {')
    expect(admin).toContain('const rows = applications.map(({ confirmToken: _t, ...a }) => a)')
    const mig = read('prisma/migrations/20260929000001_application_email_confirm/migration.sql')
    expect(mig).toContain('UPDATE "member_applications" SET "emailConfirmedAt" = "createdAt" WHERE "emailConfirmedAt" IS NULL;')
  })
  it('one status and one sentence for every refusal', () => {
    expect(route).not.toContain('{ status: 403 })\n    }\n\n    // Duplicate')
    expect(route.match(/\{ error: REFUSED \}, \{ status: (\d+) \}/g)?.every(m => m.endsWith('409 }'))).toBe(true)
  })
})

describe('10: canonical identity', () => {
  it('phone spacing, +tags and Gmail dots fold together', () => {
    expect(canonicalPhone('+90 (555) 123-45-67')).toBe('905551234567')
    expect(canonicalPhone('0090 555 123 45 67')).toBe('905551234567')
    expect(canonicalEmail('Ali.Veli+2@GoogleMail.com')).toBe('aliveli@gmail.com')
    expect(canonicalEmail('ana+x@example.com')).toBe('ana@example.com')
    expect(route).toContain('(idEmail && canonicalEmail(b.email) === idEmail) || (idPhone && canonicalPhone(b.phone) === idPhone)')
  })
})

describe('11: staff alerts name no one else', () => {
  it('a match is a flag, the timezone an IANA name or nothing', () => {
    expect(route).not.toContain('prev: ${')
    expect(route).toContain("flags.push('device or network matches a previously rejected application')")
    expect(isValidTimeZone('Europe/Istanbul')).toBe(true)
    expect(isValidTimeZone('<b>hi</b>')).toBe(false)
  })
})

describe('12: the referral chip', () => {
  it('no suspended or hidden inviter; no photo for connections-only; no credit for them either', () => {
    const ref = read('app/api/apply/referral-context/route.ts')
    expect(ref).toContain("profilePhoto: inviter.profileVisibility === 'connections' ? null : inviter.profilePhoto,")
    expect(ref).toContain('!(inviter.suspendedUntil && inviter.suspendedUntil > new Date())')
    expect(route).toContain('&& !(refOwner.suspendedUntil && refOwner.suspendedUntil > new Date()) ? cleanRef : null')
  })
})

describe('13: the draft', () => {
  it('a week in localStorage, contact details only for the tab, cleared on refusal and logout', () => {
    const draft = read('lib/applyDraft.ts')
    expect(draft).toContain('export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000')
    expect(client).toContain("sessionStorage.setItem(DRAFT_CONTACT_KEY, JSON.stringify({ email: form.email, phone: form.phone, birthdate: form.birthdate }))")
    expect(client).toContain('if (res.status === 409 || res.status === 403) clearApplyDraft()')
    expect(read('contexts/AuthContext.tsx')).toContain('clearApplyDraft()')
  })
})

describe('14: visitors and pending applicants', () => {
  it('"I don\'t live here (yet)" sends notResident; a pending retry gets an email, not a rejection', () => {
    expect(client).toContain("notResident: form.neighborhood === NOT_RESIDENT")
    expect(route).toContain('notResident:     z.boolean().optional().default(false),')
    expect(route).toContain('sendApplicationOnFileEmail(cleanEmail, liveApp?.fullName ?? cleanFirst)')
  })
})

describe('15: accessibility', () => {
  it('pressed chips in named groups, tied errors, an alert, a progress bar, focus on step change', () => {
    expect(client.split('aria-pressed=').length - 1).toBeGreaterThanOrEqual(7)
    expect(client.split('role="group"').length - 1).toBe(7)
    expect(client).toContain("aria-describedby={fieldErrors.email ? 'err-email' : undefined}")
    expect(client).toContain('role="alert"')
    expect(client).toContain('role="progressbar"')
    expect(client).toContain('stepCardRef.current?.focus({ preventScroll: true })')
    expect(client).not.toContain('text-gray-400')
  })
})

describe('16: hardening', () => {
  it('closed lists and 18+ checked on the server; legacy fields dropped', () => {
    expect(route).toContain('if (!(GENDERS as readonly string[]).includes(gender)) {')
    expect(route).toContain("socialStyles: socialStyles.filter(v => SOCIAL_STYLE_IDS.has(v)).slice(0, 3),")
    expect(route).not.toContain('linkedin:    linkedin')
    expect(ageOn('2010-01-01', new Date('2026-09-29'))).toBe(16)
    expect(ageOn('1990-09-30', new Date('2026-09-29'))).toBe(35)
  })
  it('uploads: a daily cap and none while paused; the sweep keeps up; moderators see their city\'s photos only', () => {
    const up = read('app/api/apply/upload/route.ts')
    expect(up).toContain('rateLimit(`apply-upload-day:${getIp(req)}`, 60, 24 * 60 * 60_000)')
    expect(up).toContain('if (!areApplicationsOpen()) {')
    expect(read('app/api/cron/sweep-orphan-uploads/route.ts')).toContain('const MAX_DELETIONS_PER_RUN = 2000')
    expect(read('app/api/files/[...path]/route.ts')).toContain('if (!owner || !canActInCity(session, owner.targetCityId)) {')
  })
  it('analytics switch back on only with consent at logout, login and activation', () => {
    for (const f of ['contexts/AuthContext.tsx', 'app/login/page.tsx', 'app/activate/page.tsx']) {
      expect(read(f)).toContain('if (hasAnalyticsConsent()) posthog.opt_in_capturing()')
    }
  })
})
