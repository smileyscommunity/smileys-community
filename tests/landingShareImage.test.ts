import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A page-level `openGraph` replaces the layout's object wholesale — so a page
// that leaves `images` out when it has no photo does NOT inherit the layout's
// brand card; it ships with no og:image at all. That is what /app did between
// 2026-08-16 and 2026-09-05 (its hero was never set), and the city pages carried
// the same conditional spread. Pin the fallback at source level on all three.
//
// The landing page's fallback is not the brand card but the photo the page
// itself shows when no hero is set (2026-09-05, second pass: the card was a
// picture nobody saw on arrival). Pin that the page and its metadata share
// one constant, and that the share copy of the photo stays under WhatsApp's
// ~300KB silent-drop threshold — swapping in the 546KB original would make
// every WhatsApp share blank again with no error anywhere.
const BRAND_CARD_PAGES = ['app/[city]/data.ts', 'app/cities/page.tsx']

function metadataSource(file: string): string {
  const src   = readFileSync(join(process.cwd(), file), 'utf8')
  const start = src.search(/function (generateMetadata|cityMetadata)/)
  const end   = src.indexOf('unstable_cache', start)
  return src.slice(start, end > 0 ? end : undefined)
}

describe('share images fall back to the brand card, never to nothing', () => {
  for (const file of BRAND_CARD_PAGES) {
    it(`${file} always sets og:image and the twitter card`, () => {
      const meta = metadataSource(file)
      expect(meta).toMatch(/\?\? `\$\{APP_URL\}\/api\/og`/)
      expect(meta).toMatch(/openGraph: \{[\s\S]*?images: \[\{ url: ogImage/)
      expect(meta).toMatch(/twitter: \{ card: 'summary_large_image'.*images: \[ogImage\]/)
      expect(meta).not.toMatch(/\.\.\.\(ogImage \?/)
    })
  }
})

describe('the landing page previews with the photo it shows', () => {
  const src  = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8')
  const meta = metadataSource('app/page.tsx')

  it('metadata and hero fall back to the same photo, via one constant', () => {
    expect(src).toMatch(/const HERO_FALLBACK\s*=\s*'\/app\/images\/hero-istanbul\.jpg'/)
    expect(src).toMatch(/const HERO_FALLBACK_OG\s*=\s*`\$\{APP_URL\}\/images\/hero-istanbul-og\.jpg`/)
    expect(src).toMatch(/home\.heroImage \|\| HERO_FALLBACK\b/)
    expect(meta).toMatch(/HERO_FALLBACK_OG/)
    expect(meta).not.toMatch(/api\/og/)
    expect(meta).toMatch(/openGraph: \{[\s\S]*?images: \[image\]/)
    expect(meta).toMatch(/twitter: \{ card: 'summary_large_image'.*images: \[image\.url\]/)
  })

  it('the share copy of the photo exists and is under the WhatsApp limit', () => {
    const size = statSync(join(process.cwd(), 'public/images/hero-istanbul-og.jpg')).size
    expect(size).toBeGreaterThan(20_000)
    expect(size).toBeLessThan(300_000)
  })
})
