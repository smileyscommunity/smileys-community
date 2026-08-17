import { describe, it, expect } from 'vitest'
import { pathCitySlug } from '@/lib/pathCitySlug'

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
