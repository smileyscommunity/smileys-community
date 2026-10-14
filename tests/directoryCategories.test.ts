import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_SET, ADVERTISE_SECTORS } from '@/lib/directory-constants'
import { inferCategory } from '@/lib/venueDirectory'

const read = (f: string) => readFileSync(f, 'utf8')

describe('directory categories', () => {
  it('has the categories added for coworking, hotels and culture, with Other last', () => {
    for (const c of ['Coworking', 'Accommodation', 'Culture & Activities']) expect(BUSINESS_CATEGORY_SET.has(c)).toBe(true)
    expect(BUSINESS_CATEGORIES[BUSINESS_CATEGORIES.length - 1]).toBe('Other')
    expect(new Set(BUSINESS_CATEGORIES).size).toBe(BUSINESS_CATEGORIES.length)
  })
  it('every industry /advertise names maps to categories that exist in the directory', () => {
    for (const s of ADVERTISE_SECTORS) {
      expect(s.categories.length, s.label).toBeGreaterThan(0)
      for (const c of s.categories) expect(BUSINESS_CATEGORY_SET.has(c), `${s.label} → ${c}`).toBe(true)
    }
  })
  it('the advertise page renders exactly that list, so the two cannot drift', () => {
    const page = read('app/advertise/page.tsx')
    expect(page).toMatch(/const SECTORS = ADVERTISE_SECTORS\.map\(s => s\.label\)/)
    expect(page).not.toMatch(/'Hotels & accommodation',\s*'Real estate/)
  })
  it('every category is reachable: someone can pick it when adding or editing a listing', () => {
    for (const f of ['app/(member)/directory/submit/page.tsx', 'app/admin/directory/page.tsx', 'components/DirectoryOwnerEdit.tsx', 'app/directory/DirectoryClient.tsx']) {
      expect(read(f), f).toMatch(/BUSINESS_CATEGORIES/)
    }
  })
  it('new venue stubs from events land in the right category, and a plain bar is unchanged', () => {
    expect(inferCategory('Moda Sahnesi')).toBe('Culture & Activities')
    expect(inferCategory('Nazim Hikmet Kultur Merkezi')).toBe('Culture & Activities')
    expect(inferCategory('Karaköy Coworking')).toBe('Coworking')
    expect(inferCategory('Pera Hotel')).toBe('Accommodation')
    expect(inferCategory('Dozze Kadıköy Bar')).toBe('Bar')
    expect(inferCategory('Some Coffee Roastery')).toBe('Cafe')
    expect(inferCategory('Mozaik Studio')).toBe('Other')
  })
  it('the recategorize script is a dry run unless APPLY=1 and only moves rows still in Other', () => {
    const s = read('scripts/recategorize-venues.ts')
    expect(s).toMatch(/process\.env\.APPLY === '1'/)
    expect(s).toMatch(/where: \{ id: p\.id, category: 'Other' \}/)
    expect(s).toMatch(/writeFileSync\(file/)
    for (const to of [...s.matchAll(/to: '([^']+)'/g)].map(m => m[1])) expect(BUSINESS_CATEGORY_SET.has(to), to).toBe(true)
  })
})
