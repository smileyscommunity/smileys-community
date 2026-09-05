import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// /directory shared as "Istanbul Directory" over the Istanbul cover from every
// city, for the same reason /handbook did: the city came from the session and
// a crawler has none. Same fix — ?city= in the URL, bare URL redirected to it
// for every city but the default — with one extra step the handbook did not
// need: the directory's listings and heading come from client-side fetches
// that followed the cookie, so the pinned city has to reach both APIs or the
// page would name one city and list another. Pinned at source level.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page   = read('app/directory/page.tsx')
const client = read('app/directory/DirectoryClient.tsx')
const api    = read('app/api/directory/route.ts')
const current = read('app/api/city/current/route.ts')

describe('the directory share names the city the sharer had on screen', () => {
  it('metadata lives on the page (a layout gets no searchParams) and reads ?city=', () => {
    expect(existsSync(join(process.cwd(), 'app/directory/layout.tsx'))).toBe(false)
    expect(page).toMatch(/generateMetadata\(\{ searchParams \}/)
    expect(page).toMatch(/resolveCityForPage\(searchParams\)/)
    expect(page).toMatch(/shareCover\('directory', city, title\)/)
    expect(page).toMatch(/openGraph: \{[\s\S]*?images: \[image\]/)
    expect(page).toMatch(/twitter: \{[\s\S]*?images: \[image\.url\]/)
  })

  it('a non-default city stays canonical at its hub, and og:url follows', () => {
    expect(page).toMatch(/isDefault \? `\$\{APP_URL\}\/directory` : `\$\{APP_URL\}\/\$\{city\.slug\}\/directory`/)
    expect(page).toMatch(/url: canonical/)
  })

  it('the bare URL redirects to ?city= for a non-default city, keeping the filters it carried', () => {
    expect(page).toMatch(/if \(!pinned && city\.slug !== DEFAULT_CITY_SLUG\) \{/)
    expect(page).toMatch(/qs\.set\('city', city\.slug\)\n\s*redirect\(`\/directory\?\$\{qs\}`\)/)
    expect(page).toMatch(/if \(key === 'city' \|\| value === undefined\) continue/)
  })

  it('the client carries the pinned city into both fetches and the URL sync', () => {
    expect(client).toMatch(/const pinnedCity\s*=\s*searchParams\.get\('city'\) \?\? ''/)
    expect(client).toMatch(/\/app\/api\/city\/current\$\{pinnedCity \? `\?city=\$\{encodeURIComponent\(pinnedCity\)\}` : ''\}/)
    expect(client).toMatch(/if \(pinnedCity\)\s+params\.set\('city', pinnedCity\)\n\s*fetch\(`\/app\/api\/directory\?\$\{params\}`/)
    expect(client).toMatch(/if \(pinnedCity\)\s+params\.set\('city',\s+pinnedCity\)\n\s*if \(category/)
  })

  it('both APIs scope by ?city= and fall back to the viewer\'s city', () => {
    expect(api).toMatch(/const cityId\s*=\s*\(citySlug \? \(await getPublicCity\(citySlug\)\)\?\.id : undefined\) \?\? await resolveCityId\(session\)/)
    expect(api).toMatch(/isValidNeighborhoodFor\(cityId, neighborhood\)/)
    expect(current).toMatch(/const viewedId = pinnedId \?\? await resolveCityId\(session\)/)
  })
})
