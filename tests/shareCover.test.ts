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
  it('a cover named for the city wins over everything, with no dimension hint', () => {
    const img = shareCover('handbook', { slug: 'izmir', heroImage: hero }, 'alt', f => f === 'handbook-cover-izmir.jpg')
    expect(img.url).toMatch(/\/app\/images\/handbook-cover-izmir\.jpg$/)
    expect(img).toMatchObject({ alt: 'alt', twitterCard: 'summary_large_image' })
    expect(img.width).toBeUndefined()
  })

  it('a city with no cover previews with its hero photo, size-capped, no dimension hint', () => {
    const img = shareCover('directory', { slug: 'izmir', heroImage: hero }, 'alt', none)
    expect(img.url).toMatch(/\/app\/api\/files\/general\/photo\.jpg\?w=1200$/)
    expect(img.width).toBeUndefined()
  })

  it('the default city follows the same rule — its hero photo, not a hard-wired cover (2026-09-06)', () => {
    const img = shareCover('clubs', { slug: DEFAULT_CITY_SLUG, heroImage: hero }, 'alt', none)
    expect(img.url).toMatch(/\/app\/api\/files\/general\/photo\.jpg\?w=1200$/)
  })

  it("Istanbul's purpose-made covers are its per-city files, found by the same rule", () => {
    const img = shareCover('board', { slug: DEFAULT_CITY_SLUG, heroImage: hero }, 'alt')
    expect(img.url).toMatch(/\/app\/images\/board-cover-istanbul\.jpg$/)
  })

  it('a city with neither cover nor photo still gets a picture: the brand card', () => {
    const img = shareCover('directory', { slug: 'izmir', heroImage: null }, 'alt', none)
    expect(img.url).toMatch(/\/app\/api\/og$/)
    expect(img).toMatchObject({ width: 1200, height: 630, twitterCard: 'summary_large_image' })
  })

  it('the marketplace has its own per-city slot, separate from the board', () => {
    const own = shareCover('marketplace', { slug: 'izmir', heroImage: null }, 'alt', f => f === 'marketplace-cover-izmir.jpg')
    expect(own.url).toMatch(/\/app\/images\/marketplace-cover-izmir\.jpg$/)
  })

  it('the events and clubs cards are square, so they ask for the summary twitter card', () => {
    const ev = shareCover('events', { slug: DEFAULT_CITY_SLUG, heroImage: null }, 'alt', none)
    expect(ev.url).toMatch(/\/app\/images\/events-og\.jpg$/)
    expect(ev).toMatchObject({ width: 1200, height: 1200, twitterCard: 'summary' })
    const cl = shareCover('clubs', { slug: DEFAULT_CITY_SLUG, heroImage: null }, 'alt', none)
    expect(cl.url).toMatch(/\/app\/images\/clubs-og\.jpg$/)
    expect(cl.twitterCard).toBe('summary')
    // A city's own photo or cover is landscape and wants the large card.
    expect(shareCover('events', { slug: 'izmir', heroImage: hero }, 'alt', none).twitterCard).toBe('summary_large_image')
    expect(shareCover('clubs', { slug: 'izmir', heroImage: null }, 'alt', f => f === 'clubs-cover-izmir.jpg').twitterCard).toBe('summary_large_image')
  })

  it('looks for the cover by the exact per-city file name', () => {
    const asked: string[] = []
    shareCover('directory', { slug: 'bodrum', heroImage: null }, 'alt', f => { asked.push(f); return false })
    expect(asked).toEqual(['directory-cover-bodrum.jpg'])
  })
})

describe('the cover files', () => {
  // WhatsApp silently drops an og:image over ~300KB — no error anywhere, the
  // share just has no picture. Three of these were over it until 2026-09-05.
  it('every share cover and card, per-city ones included, stays under 300KB', () => {
    const dir    = join(process.cwd(), 'public/images')
    const covers = readdirSync(dir).filter(f => /^((handbook|directory|marketplace|board|events|clubs)-cover(-[a-z0-9-]+)?|events-og|clubs-og)\.jpg$/.test(f))
    expect(covers).toEqual(expect.arrayContaining(['handbook-cover-istanbul.jpg', 'directory-cover-istanbul.jpg', 'board-cover-istanbul.jpg', 'events-og.jpg', 'clubs-og.jpg']))
    for (const f of covers) {
      const size = statSync(join(dir, f)).size
      expect(size, f).toBeGreaterThan(20_000)
      expect(size, f).toBeLessThan(300_000)
    }
  })
})
