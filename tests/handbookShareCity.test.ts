import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// /handbook has no city in its URL, so it resolved one from the session — and
// a link-preview crawler has no session and no cookie. Every share of the
// handbook, from any city, previewed as "The Istanbul Handbook" over a cover
// whose book is literally titled "Istanbul Handbook" (2026-09-05). The fix is
// the one /neighborhoods already carries: ?city= names the city, the bare URL
// redirects to the explicit one for every city but the default, and a
// non-default city shares its own hero photo. Pinned at source level, the way
// tests/landingShareImage.test.ts pins the landing page.
const src  = readFileSync(join(process.cwd(), 'app/handbook/page.tsx'), 'utf8')
const meta = src.slice(src.indexOf('export async function generateMetadata'), src.indexOf('export default async function HandbookPage'))
const page = src.slice(src.indexOf('export default async function HandbookPage'))

describe('the handbook share names the city the sharer had on screen', () => {
  it('metadata resolves the city from ?city= before the session', () => {
    expect(meta).toMatch(/generateMetadata\(\{ searchParams \}/)
    expect(meta).toMatch(/resolveCityForPage\(searchParams\)/)
    expect(meta).not.toMatch(/getSession|resolveCityId/)
  })

  it('every city but the default is canonical at its own ?city= URL, and og:url agrees', () => {
    expect(meta).toMatch(/isDefault \? `\$\{APP_URL\}\/handbook` : `\$\{APP_URL\}\/handbook\?city=\$\{city\.slug\}`/)
    expect(meta).toMatch(/alternates: \{ canonical: canonicalUrl \}/)
    expect(meta).toMatch(/url: canonicalUrl/)
  })

  it('the picture comes from lib/shareCover: a city cover, else the hero photo, else the default cover', () => {
    expect(meta).toMatch(/shareCover\('handbook', city, alt\)/)
    expect(meta).toMatch(/openGraph: \{[\s\S]*?images: \[image\]/)
    expect(meta).toMatch(/twitter: \{[\s\S]*?images: \[image\.url\]/)
  })

  it('the page redirects the bare URL to the explicit one, guarded on pinned', () => {
    expect(page).toMatch(/if \(!pinned && cfg\.slug !== DEFAULT_CITY_SLUG\) redirect\(`\/handbook\?city=\$\{cfg\.slug\}`\)/)
  })
})
