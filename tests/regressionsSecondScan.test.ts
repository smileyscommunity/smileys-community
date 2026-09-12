import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

// Regressions the second scan found in the first scan's fixes.

describe('registration deadline format', () => {
  it('is rejected at both admin write routes unless YYYY-MM-DD', () => {
    expect(read('app/api/admin/events/route.ts')).toMatch(/registrationDeadline must be YYYY-MM-DD/)
    expect(read('app/api/admin/events/[id]/route.ts')).toMatch(/registrationDeadline must be YYYY-MM-DD/)
  })
  it('is a date input on the host edit form', () => {
    expect(read('app/host/events/[id]/edit/page.tsx')).toMatch(/<input type="date" value=\{form\.registrationDeadline\}/)
  })
})

describe('unlimited-spots counter', () => {
  it('reaches the page unclamped when spots are not limited', () => {
    expect(read('lib/db.ts')).toMatch(/spotsLeft:\s*spotsLeft \?\? \(e\.limitedSpots \? Math\.max\(0, e\.spotsLeft \?\? 0\) : \(e\.spotsLeft \?\? 0\)\)/)
  })
  it('the RSVP button only reads "full" on a limited event', () => {
    const src = read('components/RSVPButton.tsx')
    expect(src).toMatch(/const isFull = soldOut \|\| \(limitedSpots && spotsLeft <= 0\)/)
    expect(read('app/events/[id]/page.tsx').match(/limitedSpots=\{event\.limitedSpots\}/g)).toHaveLength(2)
  })
  it('admin fill bars cap at 100 and "Full" respects the flag', () => {
    expect(read('app/admin/page.tsx')).toMatch(/Math\.min\(100, Math\.round/)
    expect(read('app/(member)/cup/page.tsx')).toMatch(/Math\.min\(100, Math\.round/)
    expect(read('app/admin/participants/page.tsx')).toMatch(/const full = event\.limitedSpots !== false && event\.spotsLeft <= 0/)
  })
})

describe('application approval retry', () => {
  it('rolls the application back to its previous status when account setup fails', () => {
    const src = read('app/api/admin/applications/route.ts')
    expect(src).toMatch(/data:\s*\{ status: target\.status, reviewedBy: null, reviewedAt: null \}/)
  })
})

describe('host edit form', () => {
  const src = read('app/host/events/[id]/edit/page.tsx')
  it('offers the club picker only to club hosts', () => {
    // Superseded (third scan, item 14): /api/host/clubs also lists a city
    // host's city clubs, so the picker now keys on /api/auth/me's isClubHost.
    expect(src).toMatch(/const isClubHost = \(viewer as \{ isClubHost\?: boolean \} \| null\)\?\.isClubHost === true/)
    expect(src).toMatch(/\{isClubHost && \(\s*<div>\s*<label[^>]*>Club<\/label>/)
  })
  it('offers the approval-required toggle only to staff', () => {
    expect(src).toMatch(/\.\.\.\(isStaff \? \[\{ key: 'approvalRequired'/)
  })
})
