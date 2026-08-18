import { describe, it, expect } from 'vitest'
import { pathCitySlug, cityCandidatesFromUrl } from '@/lib/pathCitySlug'

// The footer's city band belongs to the city page on screen, not to the
// session: someone landing on /bodrum from search hasn't "entered" Bodrum, so
// resolveCityId still says Istanbul and the band read "Find your people in
// Istanbul" under a Bodrum hero.
//
// Layouts get no params, so middleware forwards the path as a header and the
// root layout takes the first segment. Only the extraction is unit-testable —
// whether the segment names a real city is a DB lookup in the layout, and a
// segment like "events" simply matches no row.

describe('pathCitySlug', () => {
  it('takes the first segment of a city shopfront path', () => {
    expect(pathCitySlug('/bodrum')).toBe('bodrum')
    expect(pathCitySlug('/istanbul')).toBe('istanbul')
  })

  it('tolerates the basePath being present or stripped', () => {
    // nextUrl.pathname arrives with basePath removed, but don't depend on it.
    expect(pathCitySlug('/app/bodrum')).toBe('bodrum')
    expect(pathCitySlug('/app')).toBe('')
  })

  it('returns the first segment for deeper paths, which the DB lookup rejects', () => {
    expect(pathCitySlug('/events/123')).toBe('events')
    expect(pathCitySlug('/board/new')).toBe('board')
  })

  it('handles the root and empty input', () => {
    expect(pathCitySlug('/')).toBe('')
    expect(pathCitySlug('')).toBe('')
  })

  it('is not fooled by a leading segment that merely starts with "app"', () => {
    expect(pathCitySlug('/apply')).toBe('apply')
    expect(pathCitySlug('/application/x')).toBe('application')
  })

  it('ignores doubled slashes', () => {
    expect(pathCitySlug('//bodrum')).toBe('bodrum')
    expect(pathCitySlug('/app//bodrum')).toBe('bodrum')
  })
})

// Two URL shapes carry a city: the shopfront puts it in the path (/bodrum),
// and the pages with no city of their own put it in the query
// (/neighborhoods?city=bodrum, /visiting?city=izmir). Reading only the path
// meant every query-shaped page rendered the DEFAULT city's footer under
// another city's content — the same bug one URL shape over.
describe('cityCandidatesFromUrl', () => {
  it('reads a city out of the path', () => {
    expect(cityCandidatesFromUrl('/bodrum')).toEqual(['bodrum'])
    expect(cityCandidatesFromUrl('/app/bodrum')).toEqual(['bodrum'])
  })

  it('reads a city out of the query', () => {
    expect(cityCandidatesFromUrl('/neighborhoods?city=bodrum')).toEqual(['bodrum', 'neighborhoods'])
    expect(cityCandidatesFromUrl('/app/visiting?city=izmir')).toEqual(['izmir', 'visiting'])
  })

  it('puts ?city= first — a page that says which city it is beats the segment it lives under', () => {
    expect(cityCandidatesFromUrl('/istanbul?city=bodrum')[0]).toBe('bodrum')
  })

  it('keeps the non-city segment as a candidate, which simply matches no city row', () => {
    // "neighborhoods" is offered but will not match a city, so it changes
    // nothing — cheaper than teaching this function the route table.
    expect(cityCandidatesFromUrl('/neighborhoods')).toEqual(['neighborhoods'])
  })

  it('ignores an empty or whitespace ?city=', () => {
    expect(cityCandidatesFromUrl('/neighborhoods?city=')).toEqual(['neighborhoods'])
    expect(cityCandidatesFromUrl('/neighborhoods?city=%20%20')).toEqual(['neighborhoods'])
  })

  it('handles other params, and a bare or empty URL', () => {
    expect(cityCandidatesFromUrl('/events?tab=all')).toEqual(['events'])
    expect(cityCandidatesFromUrl('/?city=bodrum')).toEqual(['bodrum'])
    expect(cityCandidatesFromUrl('')).toEqual([])
  })

  it('de-duplicates when path and query agree', () => {
    expect(cityCandidatesFromUrl('/bodrum?city=bodrum')).toEqual(['bodrum'])
  })
})
