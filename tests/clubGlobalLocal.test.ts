import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf8')

// A global club (Club.cityId null) is listed in every city that opts in, so
// the Istanbul grid carries 32 of them beside 115 of the city's own and the
// cards looked identical. Worse, memberCount is scoped to the city being
// viewed: "3 members" on Arabic described three people in Istanbul, not a
// club of 225, and read as somewhere not worth joining.

// Mirror of memberLine in app/clubs/ClubsClient.tsx; the source assertions
// below keep the two in step.
type C = { memberCount: number; globalMemberCount?: number; cityId?: string | null }
const ELSEWHERE_SHARE = 0.8
function memberLine(club: C): string | null {
  const here = club.memberCount
  const all  = club.globalMemberCount
  const plain = here > 0 ? `${here} member${here !== 1 ? 's' : ''}` : null
  if (club.cityId != null) return plain
  if (!here) return all ? `${all} across Smileys` : null
  return all && here < all * ELSEWHERE_SHARE ? `${here} here · ${all} across Smileys` : plain
}

describe('what the member count claims', () => {
  it('a global club says where its people actually are', () => {
    expect(memberLine({ cityId: null, memberCount: 3, globalMemberCount: 225 }))
      .toBe('3 here · 225 across Smileys')
  })

  it('a local club is unchanged — its count is the whole club', () => {
    expect(memberLine({ cityId: 'c-ist', memberCount: 42, globalMemberCount: 42 }))
      .toBe('42 members')
    expect(memberLine({ cityId: 'c-ist', memberCount: 1 })).toBe('1 member')
  })

  it('a global club nobody local has joined does not print a 0 about the city', () => {
    expect(memberLine({ cityId: null, memberCount: 0, globalMemberCount: 225 }))
      .toBe('225 across Smileys')
  })

  it('does not say "here · " when everyone in the club is here anyway', () => {
    // Nothing gained by splitting a number into itself.
    expect(memberLine({ cityId: null, memberCount: 12, globalMemberCount: 12 }))
      .toBe('12 members')
  })

  // Istanbul holds nearly every member of nearly every global club today, so
  // an "any difference at all" rule put "272 here · 276 across Smileys" on
  // seven cards to describe four people. These are the real figures.
  it.each([
    [272, 276, '272 members'],
    [169, 172, '169 members'],
    [118, 120, '118 members'],
  ])('%i of %i is not worth splitting', (here, all, expected) => {
    expect(memberLine({ cityId: null, memberCount: here, globalMemberCount: all })).toBe(expected)
  })

  it('splits once a real share of the club is somewhere else', () => {
    expect(memberLine({ cityId: null, memberCount: 40, globalMemberCount: 200 }))
      .toBe('40 here · 200 across Smileys')
    // Right at the line: 80% here reads as this city's club.
    expect(memberLine({ cityId: null, memberCount: 80, globalMemberCount: 100 })).toBe('80 members')
    expect(memberLine({ cityId: null, memberCount: 79, globalMemberCount: 100 }))
      .toBe('79 here · 100 across Smileys')
  })

  it('says nothing rather than something false when both are empty', () => {
    expect(memberLine({ cityId: 'c-ist', memberCount: 0 })).toBeNull()
    expect(memberLine({ cityId: null, memberCount: 0 })).toBeNull()
  })
})

describe('the card marks which kind of club it is', () => {
  const src = read('app/clubs/ClubsClient.tsx')

  it('reads global off cityId, the field that decides it', () => {
    expect(src).toContain('const isGlobal  = club.cityId == null')
    // == null on purpose: undefined (field absent) must read as global too,
    // the same way the API omits it.
    expect(src).not.toContain('club.cityId === null')
  })

  it('badges the global ones', () => {
    expect(src).toContain('{isGlobal && (')
    expect(src).toContain('🌍 Across Smileys')
  })

  it('routes the count through the helper rather than inlining the old one', () => {
    expect(src).toContain('{memberLine(club)}')
    expect(src).not.toMatch(/\{club\.memberCount > 0\s*\n\s*\? `\$\{club\.memberCount\} member/)
  })

  it('cityId survives from the API to the card', () => {
    // lib/db spreads the club row, so the field is already there — this is
    // what would break if that select were ever narrowed.
    expect(src).toMatch(/cityId\?: string \| null/)
    expect(read('lib/db.ts')).toContain('...r,')
  })
})
