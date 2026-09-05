import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A page-level `openGraph` replaces the layout's object wholesale — so a page
// that leaves `images` out when it has no photo does NOT inherit the layout's
// brand card; it ships with no og:image at all. That is what /app did between
// 2026-08-16 and 2026-09-05 (its hero was never set), and the city pages carried
// the same conditional spread. Pin the fallback at source level on all three.
const PAGES = ['app/page.tsx', 'app/[city]/data.ts', 'app/cities/page.tsx']

function metadataSource(file: string): string {
  const src   = readFileSync(join(process.cwd(), file), 'utf8')
  const start = src.search(/function (generateMetadata|cityMetadata)/)
  const end   = src.indexOf('unstable_cache', start)
  return src.slice(start, end > 0 ? end : undefined)
}

describe('share images fall back to the brand card, never to nothing', () => {
  for (const file of PAGES) {
    it(`${file} always sets og:image and the twitter card`, () => {
      const meta = metadataSource(file)
      expect(meta).toMatch(/\?\? `\$\{APP_URL\}\/api\/og`/)
      expect(meta).toMatch(/openGraph: \{[\s\S]*?images: \[\{ url: ogImage/)
      expect(meta).toMatch(/twitter: \{ card: 'summary_large_image'.*images: \[ogImage\]/)
      expect(meta).not.toMatch(/\.\.\.\(ogImage \?/)
    })
  }
})
