import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// /clubs shared as the default city's page from every city: its metadata
// lived in a layout, which gets no searchParams, so the city came from the
// session and a crawler has none. Same fix as /directory — a server page that
// reads ?city=, redirects the bare URL to it for every city but the default,
// keeps the structured data the layout used to emit, and a client that
// carries the pinned city into the fetch the page depends on. Pinned at
// source level.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page   = read('app/clubs/page.tsx')
const client = read('app/clubs/ClubsClient.tsx')
const api    = read('app/api/clubs/route.ts')

describe('the clubs share names the city the sharer had on screen', () => {
  it('metadata lives on a server page that reads ?city=, not on a layout', () => {
    expect(existsSync(join(process.cwd(), 'app/clubs/layout.tsx'))).toBe(false)
    expect(page).not.toMatch(/^'use client'/)
    expect(page).toMatch(/generateMetadata\(\{ searchParams \}/)
    expect(page).toMatch(/resolveCityForPage\(searchParams\)/)
    expect(page).toMatch(/shareCover\('clubs', city, /)
    expect(page).toMatch(/openGraph: \{[\s\S]*?images: \[image\]/)
    expect(page).toMatch(/twitter: \{[\s\S]*?card: image\.twitterCard[\s\S]*?images: \[image\.url\]/)
  })

  it('a non-default city stays canonical at its hub, and og:url follows', () => {
    expect(page).toMatch(/isDefault \? `\$\{APP_URL\}\/clubs` : `\$\{APP_URL\}\/\$\{city\.slug\}\/clubs`/)
    expect(page).toMatch(/url: canonical/)
  })

  it('the bare URL redirects to ?city= for a non-default city, keeping the params it carried', () => {
    expect(page).toMatch(/if \(!pinned && city\.slug !== DEFAULT_CITY_SLUG\) \{/)
    expect(page).toMatch(/qs\.set\('city', city\.slug\)\n\s*redirect\(`\/clubs\?\$\{qs\}`\)/)
    expect(page).toMatch(/if \(key === 'city' \|\| value === undefined\) continue/)
  })

  it('the structured data follows the resolved city', () => {
    expect(page).toMatch(/application\/ld\+json/)
    expect(page).toMatch(/cityId/)
  })

  it('the client carries the pinned city into its fetch and the URL sync', () => {
    expect(client).toMatch(/const pinnedCity\s*=\s*searchParams\.get\('city'\) \?\? ''/)
    expect(client).toMatch(/if \(pinnedCity\)\s+params\.set\('city',\s+pinnedCity\)/)
    expect(client).toMatch(/\/app\/api\/clubs[^\n]*(city=|cityQs)/)
  })

  it('the API scopes by ?city=', () => {
    expect(api).toMatch(/searchParams\.get\('city'\)/)
  })
})
