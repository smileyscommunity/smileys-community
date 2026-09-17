import { describe, it, expect } from 'vitest'
import { isRealDate, visitDatesError, monthBounds, guestView, notifyText, cleanEmail, MAX_VISIT_DAYS } from '@/lib/visitorPolicy'

// What a visit may say, and what a guest of the public page is shown of one.

describe('visitDatesError', () => {
  const today = '2026-09-18'
  it('wants real days, in order, not past, not a residency, not a wish', () => {
    expect(visitDatesError('2026-10-01', '2026-10-10', today)).toBeNull()
    expect(visitDatesError('2026-09-18', '2026-09-18', today)).toBeNull()      // one day, today
    expect(visitDatesError('2026-02-31', '2026-03-02', today)).toMatch(/real calendar/)
    expect(visitDatesError('2026-13-45', '2026-13-46', today)).toMatch(/real calendar/)
    expect(visitDatesError('2026-10-10', '2026-10-01', today)).toMatch(/on or after/)
    expect(visitDatesError('2026-09-01', '2026-09-17', today)).toMatch(/past/)
    expect(visitDatesError('2026-10-01', '2027-01-01', today)).toMatch(new RegExp(`${MAX_VISIT_DAYS} days`))
    expect(visitDatesError('2027-10-01', '2027-10-05', today)).toMatch(/a year ahead/)
  })
  it('isRealDate', () => {
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2027-02-29')).toBe(false)
    expect(isRealDate('yesterday')).toBe(false)
    expect(isRealDate(20260918)).toBe(false)
  })
})

describe('what a guest sees', () => {
  it('a first name and the months, never the days', () => {
    expect(monthBounds('2026-10-17')).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(monthBounds('2026-02-03')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthBounds('2028-02-03')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(guestView({ name: 'Nate Gordon', startsOn: '2026-10-17', endsOn: '2026-11-02' }))
      .toEqual({ name: 'Nate', startsOn: '2026-10-01', endsOn: '2026-11-30', approximate: true })
  })
})

describe('input hygiene', () => {
  it('a push body is one short line without links', () => {
    expect(notifyText('Berlin\nRESET YOUR PASSWORD AT https://evil.example/x now')).toBe('Berlin RESET YOUR PASSWORD AT now')
    expect(notifyText('a'.repeat(80))).toHaveLength(40)
    expect(notifyText(null)).toBe('')
  })
  it('an email is an email', () => {
    expect(cleanEmail(' Nate@Example.com ')).toBe('Nate@Example.com')
    expect(cleanEmail('not an email')).toBeNull()
    expect(cleanEmail(42)).toBeNull()
  })
})
