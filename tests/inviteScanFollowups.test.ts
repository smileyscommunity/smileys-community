import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Invite scan 2026-09-29.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/(member)/invite/page.tsx')
const api  = read('app/api/invite/route.ts')

describe('invite page', () => {
  it('1: every counted referral is fetched, and the rest are accounted for', () => {
    expect(api).not.toContain('take: 20,')
    expect(api).toContain('take: 500,')
    expect(page).toContain("who {notListed === 1 ? 'is' : 'are'} no longer listed on Smileys.")
  })
  it('2: the member picks the city, starting from their home city; no Istanbul fallback', () => {
    expect(page).toContain("import { useHomeCity } from '@/hooks/useHomeCity'")
    expect(page).not.toContain('useCurrentCity')
    expect(page).not.toMatch(/'Istanbul'/)
    expect(page).toContain('<label htmlFor="invite-city"')
    expect(page).toContain('/app/apply?ref=${stats.code}&city=${inviteCity.slug}')
  })
  it('3: the share text matches where the city is', () => {
    expect(page).toContain('city.status === CITY_STATUS.Live && city.maturity === CITY_MATURITY.SelfSustaining')
    expect(page).toContain('is just getting started in ${city.name}')
    expect(page).toContain('You can apply now and be one of its founding members')
  })
  it('4: a failed load is an error with a retry, and nothing shares an empty link', () => {
    expect(page).toContain("We couldn&apos;t load your invite link")
    expect(page).toContain('onClick={loadStats}')
    expect(page.split('if (!inviteUrl').length - 1).toBe(3)
    expect(page.split('disabled={!inviteUrl}').length - 1).toBe(3)
  })
  it('5: how it works names the email step', () => {
    expect(page).toContain('They apply using your link and confirm their email')
  })
  it('6: in review means a confirmed email', () => {
    expect(api).toContain("status: 'pending', emailConfirmedAt: { not: null } }")
  })
  it('7: only listable members, and locked profiles are not links', () => {
    expect(api).toContain("status: 'approved', hiddenFromMembers: false,")
    expect(page).toContain('{m.open === false')
  })
  it('9: announced copy, hidden decoration, labeled spinner and QR, readable text', () => {
    expect(page).toContain('aria-live="polite"')
    expect(page).toContain('role="status" aria-label="Loading your invite link"')
    expect(page).toContain('role="img" aria-label={`QR code for your invite link')
    expect(page).not.toContain('text-gray-400')
    expect(page.split('<svg aria-hidden="true"').length - 1).toBe(2)
  })
  it('10: the page has its own title and is not indexed', () => {
    const layout = read('app/(member)/invite/layout.tsx')
    expect(layout).toContain("title:  'Invite friends — Smileys Community',")
    expect(layout).toContain('robots: { index: false, follow: false },')
  })
})
