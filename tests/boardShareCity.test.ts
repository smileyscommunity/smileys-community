import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// /board shared as the default city's board from every city, for the same
// reason /marketplace did: its metadata lived in a layout, which gets no
// searchParams. Same fix — a server page that reads ?city=, redirects the
// bare URL to it for every city but the default, and a feed that asks for
// the pinned city's posts. Pinned at source level.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/board/page.tsx')
const feed = read('components/BoardFeed.tsx')
const api  = read('app/api/board/route.ts')

describe('the community board share names the city the sharer had on screen', () => {
  it('metadata lives on a server page that reads ?city=, not on a layout', () => {
    expect(existsSync(join(process.cwd(), 'app/board/layout.tsx'))).toBe(false)
    expect(page).not.toMatch(/^'use client'/)
    expect(page).toMatch(/generateMetadata\(\{ searchParams \}/)
    expect(page).toMatch(/resolveCityForPage\(searchParams\)/)
    expect(page).toMatch(/shareCover\('board', city, title\)/)
    expect(page).toMatch(/openGraph: \{[\s\S]*?images: \[image\]/)
    expect(page).toMatch(/twitter: \{[\s\S]*?images: \[image\.url\]/)
  })

  it('a non-default city stays canonical at its hub, and og:url follows', () => {
    expect(page).toMatch(/isDefault \? `\$\{APP_URL\}\/board` : `\$\{APP_URL\}\/\$\{city\.slug\}\/board`/)
    expect(page).toMatch(/url: canonical/)
  })

  it('the bare URL redirects to ?city= for a non-default city, keeping the params it carried', () => {
    expect(page).toMatch(/if \(!pinned && city\.slug !== DEFAULT_CITY_SLUG\) \{/)
    expect(page).toMatch(/qs\.set\('city', city\.slug\)\n\s*redirect\(`\/board\?\$\{qs\}`\)/)
    expect(page).toMatch(/if \(key === 'city' \|\| value === undefined\) continue/)
  })

  it('the feed asks for the pinned city\'s posts and the API scopes by it', () => {
    expect(feed).toMatch(/const pinnedCity = searchParams\.get\('city'\) \?\? ''/)
    expect(feed).toMatch(/if \(pinnedCity\) params\.set\('city', pinnedCity\)\n\s*const res = await fetch\(`\/app\/api\/board\?\$\{params\}`/)
    expect(api).toMatch(/cityId: \(citySlug \? \(await getPublicCity\(citySlug\)\)\?\.id : undefined\) \?\? await resolveCityId\(session\)/)
  })
})
