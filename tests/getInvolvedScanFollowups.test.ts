import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Get-involved scan 2026-09-29, items 1–7.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page    = read('app/get-involved/page.tsx')
const contact = read('app/api/contact/route.ts')
const form    = read('app/contact/page.tsx')

describe('1: offers reach the team', () => {
  it('host and club-proposal topics with starter text', () => {
    expect(form).toContain("{ value: 'host',        label: 'Offer to host',")
    expect(form).toContain("{ value: 'club-proposal', label: 'Propose a club',")
    expect(form).toContain("topic === 'host' ? `I'd like to host")
    expect(contact).toContain("host:        'Offer to host',")
    expect(contact).toContain("'club-proposal': 'Club proposal',")
  })
  it('spam words flag an offer instead of dropping it; the limit counts only sendable messages', () => {
    // Contact scan 2026-09-29 widened this to every topic: spam words flag,
    // never drop (tests/contactScanFollowups).
    expect(contact).toContain("${reason ? ` ⚠ check: ${reason}` : ''}")
    expect(contact.indexOf('if (await rateLimitRemaining(rateKey, RATE_LIMIT) <= 0) {')).toBeGreaterThan(contact.indexOf("if (message.trim().length > 3000)"))
  })
})

describe('2: the city travels', () => {
  it('get-involved links carry it; the form sends it; the email names it and the member', () => {
    expect(page).toContain("const withCity = (topic: string) => `/contact?topic=${topic}${city.slug === DEFAULT_CITY_SLUG ? '' : `&city=${city.slug}`}`")
    expect(page).toContain(': <Link href={`/apply${qs}`} className="btn-primary--lg">Apply to join</Link>}')
    expect(form).toContain("city: citySlug ?? undefined,")
    expect(contact).toContain('const cityRow  = citySlug ? await getPublicCity(citySlug) : null')
    expect(contact).toContain('${session ? `<tr style="background:#f9fafb">')
  })
})

describe('3–4: each viewer gets a way that works for them', () => {
  it('guests are sent to apply for the member-only ways; hosts to their tools; members to invite', () => {
    expect(page).toContain("invite: session ? { label: 'Invite someone', href: '/invite' } : { label: 'Join to invite friends', href: `/apply${qs}` },")
    expect(page).toContain("story:  session ? { label: 'Write your story', href: '/share-story' } : { label: 'Join to share your story', href: `/apply${qs}` },")
    // Re-scan 2026-09-29: guests apply first; members offer; hosts plan.
    expect(page).toContain("host:   hosting ? { label: 'Plan your next event', href: '/host/events/new' }")
    expect(page).toContain(": session ? { label: 'Offer to host', href: withCity('host') }")
    expect(page).toContain(":           { label: 'Apply to host', href: `/apply${qs}` },")
    expect(page).toContain("club:   session ? { label: 'Propose a club', href: withCity('club-proposal') } : { label: 'Apply to start a club', href: `/apply${qs}` },")
    expect(page).toContain('? <Link href="/invite" className="btn-primary--lg">Invite a friend</Link>')
    expect(page).not.toContain("href: '/contact',")
  })
})

describe('5: perks the product delivers', () => {
  it('no supplier network, no directory listing for clubs, no warm introductions, no created group', () => {
    expect(page).not.toContain("'Access to our network of vetted venues and suppliers',")
    expect(page).not.toContain("'Club featured in the Smileys directory',")
    expect(page).not.toContain("'Invited friends get a warm introduction to your clubs',")
    expect(page).not.toContain("'Dedicated WhatsApp group for your members',")
    expect(page).toContain("'Listed on your city\\'s Clubs page',")
  })
})

describe('6: metadata and sitemap', () => {
  it('canonical, share card, no superlative, no dead revalidate; listed in the sitemap', () => {
    expect(page).toContain("alternates: { canonical: `${APP_URL}/get-involved` },")
    expect(page).toContain('openGraph: { title, description, url: `${APP_URL}/get-involved`')
    expect(page).not.toContain('most vibrant')
    expect(page).not.toContain('export const revalidate')
    expect(read('app/sitemap.ts')).toContain("{ url: `${BASE}/get-involved`,  priority: 0.5, changeFrequency: 'monthly' },")
  })
})

describe('7: a cleared admin headline falls back to the default', () => {
  it('trimmed on the page (get-involved, about, why, advertise) and on save', () => {
    expect(page).toContain("const headline = gi.headline?.trim() ||")
    expect(read('app/about/page.tsx')).toContain('{about.headline?.trim() ||')
    // /why builds its hero once, per city (why scan 2026-09-29).
    expect(read('app/why/page.tsx')).toContain("headline: own.headline?.trim() ||")
    expect(read('app/advertise/page.tsx')).toContain('{adv.headline?.trim() ||')
    const admin = read('app/api/admin/content/route.ts')
    expect(admin).not.toMatch(/headline: str\(r\.headline, HEADLINE_MAX\),/)
    expect(admin).not.toMatch(/subtitle: str\(r\.subtitle, SUBTITLE_MAX\),/)
  })
})

// Items 8–13 (2026-09-29).

describe('8: readable text on the amber card (buttons untouched)', () => {
  it('dark text on the accent card; grey labels darker; the card and button colours unchanged', () => {
    expect(page).toContain("${w.accent ? 'text-amber-950' : 'text-amber-600'}")
    expect(page).toContain("${w.accent ? 'text-amber-950' : 'text-gray-500'}")
    expect(page).toContain("w.accent ? 'bg-amber-500 border-amber-500'")
    expect(page).toContain("'bg-amber-500 text-white hover:bg-amber-600'")
    expect(page).not.toContain("'text-amber-50'")
  })
})

describe('9–10: city links', () => {
  it('the city clubs page keeps its city; ?city= is case-insensitive', () => {
    expect(read('app/[city]/clubs/page.tsx')).toContain('<Link href={`/get-involved${cityQs(city.slug)}`} className="btn-primary inline-flex">Become a host</Link>')
    expect(read('lib/cityPageParam.ts')).toContain('?.trim().toLowerCase()')
  })
})

describe('11–13: glyphs, the statement, the stats band', () => {
  it('decorative glyphs hidden; the line is a statement, not a quote; blank stat rows skipped', () => {
    expect(page).toContain('<span aria-hidden="true">✦</span> Get involved')
    expect(page).toContain('<div aria-hidden="true" className="text-4xl mb-4">{w.emoji}</div>')
    expect(page).not.toContain('<blockquote')
    // Re-scan 2026-09-29: measured numbers, no admin rows (so no blank ones).
    expect(page).not.toContain('resolveStats')
    expect(page).toContain("{ value: approx(s.events),  label: 'Events on Smileys' },")
    expect(page).toContain('<dl className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 text-center text-amber-950">')
    expect(page).not.toContain('member matching')
  })
})
