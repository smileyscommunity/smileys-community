import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-23. Both admin member pickers filtered out anyone already in the
// club/event and then reported absence. The search had found the member every
// time — /api/admin/users returned her for "popova", "Popova" and "anna
// popova" — and the picker discarded the row precisely BECAUSE she was already
// in, then said so in words that were not true:
//
//   club picker : rendered nothing at all (the dropdown is gated on
//                 searchResults.length > 0), so it read as a broken box
//   event picker: rendered "No members found"
//
// That is not an empty result, it is a false statement about the roster, and
// it cost four rounds of debugging the wrong search before anyone looked at
// the picker. An already-member is now shown, flagged, and not clickable.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const CLUB  = 'app/admin/clubs/[id]/page.tsx'
const EVENT = 'app/admin/events/[id]/participants/page.tsx'

describe('the club picker stops hiding members it found', () => {
  const s = src(CLUB)

  it('no longer drops already-members from the results', () => {
    expect(s).not.toContain('filter(u => !memberIds.has(u.id))')
  })

  it('flags them instead, so the row can say why it is not addable', () => {
    expect(s).toContain('alreadyIn: memberIds.has(u.id)')
  })

  it('tells the admin they are already in rather than showing nothing', () => {
    expect(s).toContain('Already in this club')
  })

  it('slices AFTER flagging, so the searched-for member can take a slot', () => {
    // Filtering before the slice is the mechanism that hid her: six addable
    // hits could fill the list and push the one being searched for out.
    const slice = s.indexOf('.slice(0, 6)')
    const flag  = s.indexOf('alreadyIn: memberIds.has(u.id)')
    expect(slice).toBeGreaterThan(-1)
    expect(flag).toBeGreaterThan(slice)
  })
})

describe('the event picker stops saying "No members found" when it found one', () => {
  const s = src(EVENT)

  it('no longer drops already-attending members', () => {
    expect(s).not.toContain('filter(u => !alreadyIn.has(u.id))')
  })

  it('flags them and labels the row', () => {
    expect(s).toContain('alreadyIn: alreadyIn.has(u.id)')
    expect(s).toContain('Already going')
  })

  it('keeps the empty-state string for the one case where it is true', () => {
    // Still needed — a search that genuinely matches nobody should say so.
    expect(s).toContain("'No members found'")
    expect(s).toContain("searching ? 'Searching…' : 'No members found'")
  })
})

describe('an already-in row is not a control', () => {
  it.each([[CLUB, 'Already in this club'], [EVENT, 'Already going']])(
    '%s renders the flagged branch as a div, not a disabled button',
    (file, label) => {
      const s = src(file)
      // A disabled <button> is still exposed as a control that does nothing.
      // The branch that carries the label must be a div with no onClick.
      const i = s.indexOf(label)
      expect(i).toBeGreaterThan(-1)
      const branch = s.slice(Math.max(0, i - 700), i)
      expect(branch).toMatch(/<div key=\{(u|user)\.id\}/)
      const lastDiv = branch.lastIndexOf('<div key=')
      expect(branch.slice(lastDiv)).not.toContain('onClick')
    },
  )

  it('and both pickers still offer Add for members who are not in yet', () => {
    for (const f of [CLUB, EVENT]) {
      expect(src(f), f).toContain('Add →')
    }
    expect(src(CLUB)).toContain('onClick={() => addMember(user.id)}')
    expect(src(EVENT)).toContain('onClick={() => addParticipant(u)}')
  })
})
