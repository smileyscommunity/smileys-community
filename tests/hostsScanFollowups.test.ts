import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { rosterSummary, hostActivityLine } from '@/lib/hostTitles'

// Hosts scan 2026-09-28, items 1–6: the lead is one of the hosts; the card
// line never repeats the chip; hosts of global clubs join their home city;
// the cookie page carries per-city metadata and honors ?city=; the links
// into it keep the city; the default city's page is in the sitemap and its
// twin's og:url is the canonical.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const cookiePage = read('app/hosts/page.tsx')
const cityPage   = read('app/[city]/hosts/page.tsx')
const hub        = read('components/HostsHub.tsx') // 2026-09-28 item 13: both pages render this
const section    = read('app/[city]/sections/Hosts.tsx')
const roster     = read('lib/hostRoster.ts')
const moving     = read('app/[city]/moving/page.tsx')
const involved   = read('app/get-involved/page.tsx')
const sitemap    = read('app/sitemap.ts')

describe('the hero line counts the lead once (item 1)', () => {
  it('one person is one person, whatever the title', () => {
    expect(rosterSummary(1, 1, 'Ankara')).toBe('One City Lead — the member who makes Ankara happen.')
    expect(rosterSummary(1, 0, 'Bursa')).toBe('One host — the member who makes Bursa happen.')
  })
  it('a roster with a lead says the lead is among the hosts', () => {
    expect(rosterSummary(3, 1, 'Izmir')).toBe('3 hosts, one of them the City Lead — the members who make Izmir happen.')
    expect(rosterSummary(62, 2, 'Istanbul')).toBe('62 hosts, 2 of them City Leads — the members who make Istanbul happen.')
    expect(rosterSummary(4, 0, 'Antalya')).toBe('4 hosts — the members who make Antalya happen.')
  })
  it('an empty roster keeps the open-seat line', () => {
    expect(rosterSummary(0, 0, 'Tbilisi')).toBe('Tbilisi is looking for its first hosts — the seat is open.')
  })
  it('the page uses it', () => {
    expect(hub).toContain('{rosterSummary(hosts.length, leads, city.name)}')
    expect(cityPage).not.toContain("`, ${leads} ${leads === 1 ? HOST_TITLE.lead")
  })
})

describe('the card line never repeats the chip (item 2)', () => {
  it('a zero-event lead or host reads what they do', () => {
    expect(hostActivityLine({ title: 'lead', upcomingCount: 0, hostedCount: 0 })).toBe('Leads the city')
    expect(hostActivityLine({ title: 'host', upcomingCount: 0, hostedCount: 0 })).toBe('Runs a club')
    expect(hostActivityLine({ title: 'lead', upcomingCount: 1, hostedCount: 0 })).toBe('1 upcoming event')
  })
})

describe('hosts of global clubs join their home city (item 3)', () => {
  it('the club-host query takes a city club OR a global club with the host living in the city', () => {
    expect(roster).toContain('{ club: { isActive: true, cityId } },')
    expect(roster).toContain('{ club: { isActive: true, cityId: null }, user: { cityId } },')
    // The user gate still applies to both arms (item 9 made it `listable`).
    const q = roster.slice(roster.indexOf('prisma.clubMembership.findMany'), roster.indexOf('prisma.cityHost.findMany'))
    expect(q).toContain("user: listable,")
  })
})

describe('the cookie page is per city (items 4–5)', () => {
  it('metadata is generated from the resolved city, with canonical and Open Graph', () => {
    expect(cookiePage).not.toContain('export const metadata')
    expect(cookiePage).toContain('export async function generateMetadata({ searchParams }: Props)')
    expect(cookiePage).toContain("const canonical   = city.slug === DEFAULT_CITY_SLUG ? `${APP_URL}/hosts` : `${APP_URL}/${city.slug}/hosts`")
    expect(cookiePage).toContain('openGraph: { title, description, url: canonical, images: [image] }')
    expect(cookiePage).toContain("shareCover('hosts', city, title)")
  })
  it('the page resolves ?city= like every other hub and pins it in the URL', () => {
    expect(cookiePage).toContain('const { city, cityId, pinned } = await resolveCityForPage(searchParams)')
    expect(cookiePage).toContain("if (!pinned && city.slug !== DEFAULT_CITY_SLUG) redirect(`/hosts?city=${city.slug}`)")
    expect(cookiePage).not.toContain('resolveCityId(session)')
  })
  it('the fixed-city links into the hosts pages keep the city', () => {
    expect(moving).toContain("const hostsHref  = isDefaultCitySlug(city.slug) ? '/hosts' : `/${city.slug}/hosts`")
    expect(moving).toContain('<Link href={hostsHref}')
    expect(moving).not.toContain('href="/hosts"')
    expect(involved).toContain('const { city } = await resolveCityForPage(searchParams)')
    expect(involved).toContain('<Link href={`/hosts${cityQs(city.slug)}`}')
    expect(involved).toContain('<HostPath cityName={city.name} />')
    expect(hub).toContain('const involved = `/get-involved${cityQs(city.slug)}`')
    expect(hub.split('href={involved}').length - 1).toBe(2)
    expect(section).toContain('<Link href={`/get-involved${cityQs(city.slug)}`}')
  })
})

describe('the default city\'s page is advertised and its twin agrees with it (item 6)', () => {
  it('the sitemap lists /hosts among the static routes', () => {
    expect(sitemap).toContain("{ url: `${BASE}/hosts`,         priority: 0.6, changeFrequency: 'weekly',  lastModified: newestEvent },")
  })
  it('the fixed-city page shares under its canonical', () => {
    expect(cityPage).toContain("const canonical = hubCanonical(city.slug, 'hosts')")
    expect(cityPage).toContain('openGraph: { title, description, url: canonical, images: [image] }')
    expect(cityPage).not.toContain('url: `${APP_URL}/${city.slug}/hosts`')
  })
})
