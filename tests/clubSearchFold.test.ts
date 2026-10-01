import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fold } from '../lib/turkishFold'

// 2026-10-01: the admin clubs search "did not extract clubs". On the real
// data, "İstanbul" and "İzmir" matched 0 (toLowerCase turns İ into i + a
// combining dot), "food & drinks" matched 0 (category not searched) and
// "spanish club" missed "Spanish Language Club" (one exact phrase).
const admin  = readFileSync(join(__dirname, '../app/admin/clubs/page.tsx'), 'utf8')
const member = readFileSync(join(__dirname, '../app/clubs/ClubsClient.tsx'), 'utf8')

// The admin page's matcher, as written there.
const adminMatch = (q: string, c: { name: string; description: string; slug: string; category: string; city?: { name: string } | null }) => {
  const words = fold(q).split(/\s+/).filter(Boolean)
  const hay = fold(`${c.name} ${c.description} ${c.slug} ${c.category} ${c.city?.name ?? 'global'}`)
  return words.every(w => hay.includes(w))
}
const spanish = { name: 'Spanish Language Club', description: 'Practise Spanish over coffee.', slug: 'spanish-language', category: 'Language', city: { name: 'İstanbul' } }
const hiking  = { name: 'Hiking', description: 'Trails around the city.', slug: 'hiking-izmir', category: 'Outdoor', city: { name: 'İzmir' } }

describe('clubs search folds Turkish letters and matches word by word', () => {
  it('a Turkish keyboard finds the city', () => {
    expect(adminMatch('İstanbul', spanish)).toBe(true)
    expect(adminMatch('istanbul', spanish)).toBe(true)
    expect(adminMatch('İZMİR', hiking)).toBe(true)
    // The old matcher, for the record: this is the bug.
    expect('İstanbul'.toLowerCase() === 'istanbul').toBe(false)
  })
  it('words in any order, and the category counts', () => {
    expect(adminMatch('spanish club', spanish)).toBe(true)
    expect(adminMatch('club spanish', spanish)).toBe(true)
    expect(adminMatch('language', spanish)).toBe(true)
    expect(adminMatch('outdoor izmir', hiking)).toBe(true)
    expect(adminMatch('spanish izmir', spanish)).toBe(false)
  })
  it('both pages use the fold, not a bare toLowerCase', () => {
    expect(admin).toContain("import { fold } from '@/lib/turkishFold'")
    expect(admin).toContain('const searchWords = fold(search).split(/\\s+/).filter(Boolean)')
    expect(admin).toContain("fold(`${c.name} ${c.description} ${c.slug} ${c.category} ${c.city?.name ?? 'global'}`)")
    expect(admin).not.toContain('const q = search.trim().toLowerCase()')
    expect(member).toContain("import { fold } from '@/lib/turkishFold'")
    expect(member).toContain('qWords.every(w => fold(`${c.name} ${c.description} ${c.category}`).includes(w))')
    expect(member).not.toContain('const q = search.trim().toLowerCase()')
  })
})
