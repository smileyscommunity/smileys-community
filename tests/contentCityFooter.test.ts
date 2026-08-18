import { describe, it, expect } from 'vitest'
import { contentCitySlugPath, cityCandidatesFromUrl } from '@/lib/pathCitySlug'

// Which city dresses the page. A URL that names its city wins; a page whose
// city lives in the row (a guide experience, a route, a neighborhood) is
// resolved from the row; a feed keeps following the reader.

describe('contentCitySlugPath', () => {
  it('recognises the pages whose city is a property of the content', () => {
    expect(contentCitySlugPath('/app/guide/kara-ada-hot-springs')).toEqual({ kind: 'guide', slug: 'kara-ada-hot-springs' })
    expect(contentCitySlugPath('/guide/routes/bosphorus-day')).toEqual({ kind: 'route', slug: 'bosphorus-day' })
    expect(contentCitySlugPath('/app/neighborhoods/gumusluk')).toEqual({ kind: 'neighborhood', slug: 'gumusluk' })
  })

  it('does NOT claim the index pages — they are feeds of the reader\'s city', () => {
    for (const p of ['/app/guide', '/guide', '/app/neighborhoods', '/app/events', '/app/clubs', '/app/board', '/']) {
      expect(contentCitySlugPath(p), p).toBeNull()
    }
  })

  it('keeps a query string out of the slug', () => {
    expect(contentCitySlugPath('/app/guide/kara-ada-hot-springs?ref=share')).toEqual({ kind: 'guide', slug: 'kara-ada-hot-springs' })
  })

  it('never mistakes /guide/routes for an experience called "routes"', () => {
    // The one collision the two shapes could produce.
    expect(contentCitySlugPath('/app/guide/routes/first-day-istanbul')?.kind).toBe('route')
  })

  it('leaves the explicit-city URLs to the existing helper', () => {
    // A city shopfront and a ?city= page already announce themselves; those
    // must keep winning, so this returns nothing for them.
    expect(contentCitySlugPath('/app/bodrum')).toBeNull()
    expect(cityCandidatesFromUrl('/app/bodrum')).toContain('bodrum')
    expect(cityCandidatesFromUrl('/app/neighborhoods?city=izmir')[0]).toBe('izmir')
  })
})
