import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { shareCover } from '@/lib/shareCover'
import { DEFAULT_CITY_SLUG } from '@/lib/city'

// Every city-scoped public page shared the default city's cover under its own
// name: "The Izmir Handbook" over a book titled "Istanbul Handbook". The
// helper's order — a cover made for the city, else its hero photo, else (for
// the default city only, or when there is nothing else) the bare cover — is
// what every such page now relies on, so pin it.

const none = () => false
const hero = '/app/api/files/general/photo.jpg'

describe('shareCover', () => {
  it('a cover named for the city wins over everything, with known dimensions', () => {
    const img = shareCover('handbook', { slug: 'izmir', heroImage: hero }, 'alt', f => f === 'handbook-cover-izmir.jpg')
    expect(img.url).toMatch(/\/app\/images\/handbook-cover-izmir\.jpg$/)
    expect(img).toMatchObject({ width: 1200, height: 800, alt: 'alt' })
  })

  it('a non-default city with no cover previews with its hero photo, size-capped, no dimension hint', () => {
    const img = shareCover('directory', { slug: 'izmir', heroImage: hero }, 'alt', none)
    expect(img.url).toMatch(/\/app\/api\/files\/general\/photo\.jpg\?w=1200$/)
    expect(img.width).toBeUndefined()
  })

  it('the default city keeps the bare cover even when it has a hero photo', () => {
    const img = shareCover('handbook', { slug: DEFAULT_CITY_SLUG, heroImage: hero }, 'alt', none)
    expect(img.url).toMatch(/\/app\/images\/handbook-cover\.jpg$/)
  })

  it('a non-default city with neither cover nor photo still gets a picture', () => {
    const img = shareCover('directory', { slug: 'izmir', heroImage: null }, 'alt', none)
    expect(img.url).toMatch(/\/app\/images\/directory-cover\.jpg$/)
  })

  it("the marketplace kept the board's cover as its bare one", () => {
    const img = shareCover('marketplace', { slug: DEFAULT_CITY_SLUG, heroImage: null }, 'alt', none)
    expect(img.url).toMatch(/\/app\/images\/board-cover\.jpg$/)
    const own = shareCover('marketplace', { slug: 'izmir', heroImage: null }, 'alt', f => f === 'marketplace-cover-izmir.jpg')
    expect(own.url).toMatch(/\/app\/images\/marketplace-cover-izmir\.jpg$/)
  })

  it('looks for the cover by the exact per-city file name', () => {
    const asked: string[] = []
    shareCover('directory', { slug: 'bodrum', heroImage: null }, 'alt', f => { asked.push(f); return false })
    expect(asked).toEqual(['directory-cover-bodrum.jpg'])
  })
})

describe('the cover files', () => {
  // WhatsApp silently drops an og:image over ~300KB — no error anywhere, the
  // share just has no picture. Both bare covers were over it until 2026-09-05.
  it('every handbook/directory/marketplace cover, per-city ones included, stays under 300KB', () => {
    const dir    = join(process.cwd(), 'public/images')
    const covers = readdirSync(dir).filter(f => /^(handbook|directory|marketplace|board)-cover(-[a-z0-9-]+)?\.jpg$/.test(f))
    expect(covers).toEqual(expect.arrayContaining(['handbook-cover.jpg', 'directory-cover.jpg', 'board-cover.jpg']))
    for (const f of covers) {
      const size = statSync(join(dir, f)).size
      expect(size, f).toBeGreaterThan(20_000)
      expect(size, f).toBeLessThan(300_000)
    }
  })
})
