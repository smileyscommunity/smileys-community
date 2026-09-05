import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// /marketplace shared as "Smileys Marketplace — Istanbul" over the board
// cover from every city: its metadata lived in a layout, which gets no
// searchParams, so the city came from the session and a crawler has none.
// Same fix as /directory — a server page that reads ?city=, redirects the
// bare URL to it for every city but the default, and a client that carries
// the pinned city into every fetch the page depends on. Pinned at source.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/marketplace/page.tsx')
const hub  = read('components/BoardHub.tsx')
const api  = read('app/api/listings/route.ts')

describe('the marketplace share names the city the sharer had on screen', () => {
  it('metadata lives on a server page that reads ?city=, not on a layout', () => {
    expect(existsSync(join(process.cwd(), 'app/marketplace/layout.tsx'))).toBe(false)
    expect(page).not.toMatch(/^'use client'/)
    expect(page).toMatch(/generateMetadata\(\{ searchParams \}/)
    expect(page).toMatch(/resolveCityForPage\(searchParams\)/)
    expect(page).toMatch(/shareCover\('marketplace', city, ogTitle\)/)
    expect(page).toMatch(/openGraph: \{[\s\S]*?images: \[image\]/)
    expect(page).toMatch(/twitter: \{[\s\S]*?images: \[image\.url\]/)
  })

  it('every city but the default is canonical at its own ?city= URL, and og:url agrees', () => {
    expect(page).toMatch(/isDefault \? `\$\{APP_URL\}\/marketplace` : `\$\{APP_URL\}\/marketplace\?city=\$\{city\.slug\}`/)
    expect(page).toMatch(/url: canonical/)
  })

  it('the bare URL redirects to ?city= for a non-default city, keeping the params it carried', () => {
    expect(page).toMatch(/if \(!pinned && city\.slug !== DEFAULT_CITY_SLUG\) \{/)
    expect(page).toMatch(/qs\.set\('city', city\.slug\)\n\s*redirect\(`\/marketplace\?\$\{qs\}`\)/)
    expect(page).toMatch(/if \(key === 'city' \|\| value === undefined\) continue/)
  })

  it('the hub carries the pinned city into the listings, the neighborhoods, the heading and the URL sync', () => {
    expect(hub).toMatch(/const pinnedCity = searchParams\.get\('city'\) \?\? ''/)
    expect(hub).toMatch(/if \(pinnedCity\) params\.set\('city', pinnedCity\)\n\s*const res = await fetch\(`\/app\/api\/listings\?\$\{params\}`/)
    expect(hub).toMatch(/useCityNeighborhoods\(pinnedCity \|\| undefined\)/)
    expect(hub).toMatch(/\/app\/api\/city\/current\?city=\$\{encodeURIComponent\(pinnedCity\)\}/)
    expect(hub).toMatch(/const cityName = \(pinnedCity \? pinnedName : cookieCity\?\.name\) \?\? ''/)
    expect(hub).toMatch(/if \(pinnedCity\)\s+params\.set\('city',\s+pinnedCity\)\n\s*if \(category !== 'ALL'\)/)
  })

  it('the listings API scopes the browse feed by ?city= and falls back to the viewer\'s city', () => {
    expect(api).toMatch(/const cityId\s*=\s*\(citySlug \? \(await getPublicCity\(citySlug\)\)\?\.id : undefined\) \?\? await resolveCityId\(session\)/)
    expect(api).toMatch(/\.\.\.\(mine && session \? \{\} : \{ cityId \}\)/)
  })
})
