import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { validateFieldUpdate, validateBusinessCreate, parseCoverCredit } from '@/app/api/admin/directory/_lib'
import { creditedCoverOk } from '@/lib/photoCredit'

// A cover can be someone else's photo (Wikimedia Commons, CC BY / BY-SA),
// usable only with its author and license shown wherever it appears. These pin
// the two ways that goes wrong: a credit outliving its photo (a new cover
// shown under the old photographer's name), and a credited photo appearing
// somewhere its credit can't (share cards, JSON-LD).

const COVER = '/app/api/files/directory/1790593131148-b148bdc8c324.jpg'
const CREDIT = 'Asibala · CC BY-SA 4.0'
const URL_ = 'https://commons.wikimedia.org/wiki/File:Example.jpg'

describe('parseCoverCredit', () => {
  it('keeps one line of plain text, capped', () => {
    const r = parseCoverCredit({ coverCredit: '  <b>Asibala</b>\n· CC BY-SA 4.0 ' })
    expect(r).toEqual({ coverCredit: 'Asibala · CC BY-SA 4.0' })
    const long = parseCoverCredit({ coverCredit: 'x'.repeat(400) }) as { coverCredit: string }
    expect(long.coverCredit.length).toBe(160)
  })
  it('accepts only an https link', () => {
    expect(parseCoverCredit({ coverCreditUrl: URL_ })).toEqual({ coverCreditUrl: URL_ })
    expect(parseCoverCredit({ coverCreditUrl: 'http://commons.wikimedia.org/x' })).toHaveProperty('error')
    expect(parseCoverCredit({ coverCreditUrl: 'javascript:alert(1)' })).toHaveProperty('error')
    expect(parseCoverCredit({ coverCreditUrl: '/relative' })).toHaveProperty('error')
    expect(parseCoverCredit({ coverCreditUrl: '' })).toEqual({ coverCreditUrl: null })
  })
  it('says nothing about keys that are absent', () => {
    expect(parseCoverCredit({ name: 'x' })).toEqual({})
  })
})

describe('validateFieldUpdate — the credit belongs to one photo', () => {
  it('sets the credit together with its cover', () => {
    const r = validateFieldUpdate({ coverImage: COVER, coverCredit: CREDIT, coverCreditUrl: URL_ }) as { data: Record<string, unknown> }
    expect(r.data).toMatchObject({ coverImage: COVER, coverCredit: CREDIT, coverCreditUrl: URL_ })
  })
  it('clears the old credit when the cover changes without one', () => {
    const r = validateFieldUpdate({ coverImage: COVER }) as { data: Record<string, unknown> }
    expect(r.data).toMatchObject({ coverImage: COVER, coverCredit: null, coverCreditUrl: null })
  })
  it('clears the credit when the cover is removed, even if one was sent', () => {
    const r = validateFieldUpdate({ coverImage: '', coverCredit: CREDIT }) as { data: Record<string, unknown> }
    expect(r.data).toMatchObject({ coverImage: null, coverCredit: null, coverCreditUrl: null })
  })
  it('edits the credit alone without touching the cover', () => {
    const r = validateFieldUpdate({ coverCredit: CREDIT }) as { data: Record<string, unknown> }
    expect(r.data).toEqual({ coverCredit: CREDIT })
  })
  it('an owner changing their cover also drops the old credit', () => {
    const r = validateFieldUpdate({ coverImage: COVER }, { owner: true }) as { data: Record<string, unknown> }
    expect(r.data).toMatchObject({ coverImage: COVER, coverCredit: null, coverCreditUrl: null })
  })
  it('rejects a non-https credit link', () => {
    expect(validateFieldUpdate({ coverCreditUrl: 'http://x.example' })).toHaveProperty('error')
  })
})

describe('validateBusinessCreate', () => {
  const base = { name: 'Minoa Pera', category: 'Cafe', description: 'A bookshop café.' }
  it('stores a credit only with a cover', () => {
    const withCover = validateBusinessCreate({ ...base, coverImage: `https://example.com/a.jpg`, coverCredit: CREDIT, coverCreditUrl: URL_ }) as { data: Record<string, unknown> }
    expect(withCover.data).toMatchObject({ coverCredit: CREDIT, coverCreditUrl: URL_ })
    const noCover = validateBusinessCreate({ ...base, coverCredit: CREDIT }) as { data: Record<string, unknown> }
    expect(noCover.data).toMatchObject({ coverImage: null, coverCredit: null, coverCreditUrl: null })
  })
})

describe('creditedCoverOk — where no credit can be shown', () => {
  it('uses a cover only when it needs no credit', () => {
    expect(creditedCoverOk({ coverImage: COVER, coverCredit: null })).toBe(true)
    expect(creditedCoverOk({ coverImage: COVER, coverCredit: '   ' })).toBe(true)
    expect(creditedCoverOk({ coverImage: COVER, coverCredit: CREDIT })).toBe(false)
    expect(creditedCoverOk({ coverImage: null, coverCredit: null })).toBe(false)
  })
})

describe('every surface that renders a listing cover renders its credit', () => {
  // Source pins: a new surface that shows a directory cover must show the
  // credit too, or the license is broken there.
  const SURFACES = [
    'app/directory/[id]/page.tsx',
    'app/directory/DirectoryClient.tsx',
    'app/(member)/directory/saved/page.tsx',
    'components/LocalFavorites.tsx',
    'app/neighborhoods/[slug]/NeighborhoodSections.tsx',
    'app/[city]/directory/page.tsx',
  ]
  for (const f of SURFACES) {
    it(f, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).toMatch(/<PhotoCredit\b/)
      expect(src).toMatch(/coverCredit/)
    })
  }
  it('share cards and JSON-LD skip a credited cover', () => {
    expect(readFileSync('app/directory/[id]/page.tsx', 'utf8').match(/creditedCoverOk\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(readFileSync('app/neighborhoods/[slug]/NeighborhoodSections.tsx', 'utf8')).toMatch(/creditedCoverOk\(b\)/)
  })
})
