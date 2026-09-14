import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { postingNeighborhoodsCity, neighborhoodIfListed } from '@/lib/postingNeighborhoods'

const read = (p: string) => readFileSync(p, 'utf-8')

// Hangout, pulse and listing POSTs validate the neighborhood against the
// POSTING city (resolvePostingCityId), and safeNeighborhoodFor drops a name
// from any other city silently. The composers listed the BROWSED city's names,
// so a member browsing another city filed hangouts with no neighborhood, no
// neighborhood fan-out, and pulses whose audience fell back to connections.

describe('postingNeighborhoodsCity', () => {
  it('waits (null) while the city has not loaded — never undefined, which fetches the browsed list', () => {
    expect(postingNeighborhoodsCity(null)).toBeNull()
  })
  it('uses the posting slug, not the viewed one', () => {
    expect(postingNeighborhoodsCity({ slug: 'izmir', posting: { slug: 'istanbul' } })).toBe('istanbul')
    expect(postingNeighborhoodsCity({ slug: 'izmir', posting: { slug: 'izmir' } })).toBe('izmir')
  })
  it('falls back to the viewed city when there is no posting city', () => {
    expect(postingNeighborhoodsCity({ slug: 'izmir' })).toBe('izmir')
  })
})

describe('neighborhoodIfListed', () => {
  const istanbul = ['Moda', 'Cihangir']
  it('keeps a prefill the posting city has', () => {
    expect(neighborhoodIfListed('Moda', istanbul)).toBe('Moda')
  })
  it('drops a prefill from another city (the Alsancak case)', () => {
    expect(neighborhoodIfListed('Alsancak', istanbul)).toBe('')
  })
  it('selects nothing while the list is still loading, and for empty input', () => {
    expect(neighborhoodIfListed('Moda', [])).toBe('')
    expect(neighborhoodIfListed('', istanbul)).toBe('')
    expect(neighborhoodIfListed(null, istanbul)).toBe('')
    expect(neighborhoodIfListed(undefined, istanbul)).toBe('')
  })
})

describe('useCityNeighborhoods(null) fetches nothing', () => {
  it('returns before building a URL when the city is not known yet', () => {
    const hook = read('hooks/useCityNeighborhoods.ts')
    expect(hook).toMatch(/city\?: string \| null/)
    expect(hook).toMatch(/if \(city === null\) \{ setNeighborhoods\(\[\]\); return \}/)
    expect(hook.indexOf('city === null')).toBeLessThan(hook.indexOf('const url ='))
  })
})

describe('composers list the posting city’s neighborhoods', () => {
  it.each(['app/(member)/hangouts/page.tsx', 'app/(member)/board/new/page.tsx'])(
    '%s has no bare useCityNeighborhoods()', (file) => {
      expect(read(file)).not.toMatch(/useCityNeighborhoods\(\s*\)/)
    })

  describe('hangouts page', () => {
    const src = read('app/(member)/hangouts/page.tsx')

    it('feeds the posting slug into the composer list', () => {
      expect(src).toMatch(/const postingNeighborhoods = useCityNeighborhoods\(postingNeighborhoodsCity\(city\)\)/)
    })
    it('both composer selects map the posting list and guard their prefill', () => {
      expect(src).toMatch(/value=\{neighborhoodIfListed\(neighborhood, postingNeighborhoods\)\}/)
      expect(src).toMatch(/value=\{neighborhoodIfListed\(pulseNeighborhood, postingNeighborhoods\)\}/)
      expect(src.match(/\{postingNeighborhoods\.map\(n => <option/g)).toHaveLength(2)
    })
    it('both POST bodies send only a listed neighborhood', () => {
      expect(src).toMatch(/neighborhood: neighborhoodIfListed\(neighborhood, postingNeighborhoods\) \|\| undefined/)
      expect(src).toMatch(/neighborhood: neighborhoodIfListed\(pulseNeighborhood, postingNeighborhoods\) \|\| undefined/)
    })
    it('both forms show the posting hint when posting differs', () => {
      expect(src.match(/\{postingCity\?\.differs && \(/g)).toHaveLength(2)
      expect(src.match(/Posting to <strong>\{postingCity\.name\}<\/strong>/g)).toHaveLength(2)
    })
    it('the card edit keeps the VIEWED city list (PATCH validates against the hangout’s own city)', () => {
      expect(src).toMatch(/const neighborhoods = useCityNeighborhoods\(city\?\.slug \?\? null\)/)
      expect(src).toMatch(/neighborhoods=\{neighborhoods\}/)
      // the read side still fetches the viewed city's feed
      expect(src).toMatch(/fetch\('\/app\/api\/hangouts', +\{ credentials: 'include' \}\)/)
      expect(src).toMatch(/fetch\('\/app\/api\/availability', +\{ credentials: 'include' \}\)/)
    })
  })

  describe('board/new', () => {
    const src = read('app/(member)/board/new/page.tsx')

    it('feeds the posting slug into the list', () => {
      expect(src).toMatch(/const neighborhoods = useCityNeighborhoods\(postingNeighborhoodsCity\(city\)\)/)
      // city must be declared before it is used
      expect(src.indexOf('const city = useCurrentCity()')).toBeLessThan(src.indexOf('useCityNeighborhoods(postingNeighborhoodsCity(city))'))
    })
    it('guards the ?neighborhood= prefill in the select and the POST', () => {
      expect(src).toMatch(/value=\{neighborhoodIfListed\(neighborhood, neighborhoods\)\}/)
      expect(src).toMatch(/neighborhood: neighborhoodIfListed\(neighborhood, neighborhoods\) \|\| null/)
    })
    it('keeps the posting hint and the differs callout', () => {
      expect(src).toMatch(/Posting to <span className="font-semibold text-gray-900">\{city\.posting\.name\}<\/span>/)
      expect(src).toMatch(/\{city\?\.posting\?\.differs && \(/)
    })
  })
})
