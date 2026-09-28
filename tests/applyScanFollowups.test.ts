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
    expect(route).toContain("if (!cleanNeighborhood && await prisma.neighborhood.count({ where: { cityId: targetCityId, active: true } }) > 0) {")
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
    expect(route).toContain('const identityConditions = [')
    expect(route).toContain("if (blacklistedDevice) flags.push('device or network on the blacklist')")
    expect(route.indexOf('await verifyTurnstile(')).toBeLessThan(route.indexOf('rateLimit(`apply:${getIp(req)}`'))
    expect(route).toContain("!(a.status === 'rejected' && a.reviewNote?.startsWith('Auto-rejected: velocity'))")
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
