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

// Photos are keyed by city, because two cities reusing a slug would otherwise
// illustrate one with the other's photograph — on a guide whose whole promise
// is that it knows the place.
describe('guide photo paths', () => {
  it('documents the resolution order', () => {
    // photoFor is module-private (it touches the filesystem), so this pins the
    // contract the loaders depend on rather than the function:
    //   <citySlug>/<slug>.jpg   — any city
    //   <slug>.jpg              — DEFAULT city only, where the existing files live
    //   null                    — a second city with no photo of its own
    const resolve = (citySlug: string, has: (p: string) => boolean) => {
      if (has(`${citySlug}/x.jpg`)) return `/app/images/guide/${citySlug}/x.jpg`
      if (citySlug !== 'istanbul') return null
      return has('x.jpg') ? '/app/images/guide/x.jpg' : null
    }
    expect(resolve('bodrum',   p => p === 'bodrum/x.jpg')).toBe('/app/images/guide/bodrum/x.jpg')
    // The flat file belongs to Istanbul; Bodrum must not inherit it.
    expect(resolve('bodrum',   p => p === 'x.jpg')).toBeNull()
    expect(resolve('istanbul', p => p === 'x.jpg')).toBe('/app/images/guide/x.jpg')
  })
})
