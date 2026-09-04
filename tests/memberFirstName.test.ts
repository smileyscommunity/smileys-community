import { describe, it, expect } from 'vitest'
import { firstNameOf, getInitials, formatName } from '@/lib/data'

// Dr. Hilmi Songur joined and the whole site called him "Dr." — every
// greeting, every "X is interested in your listing", his initials. The cause
// was name.split(' ')[0] in 150 places. These pin the replacement's edges,
// especially the Turkish ones, where titles stack and casing is a trap.

describe('firstNameOf', () => {
  it('skips a title to reach the person', () => {
    expect(firstNameOf('Dr. Hilmi Songur')).toBe('Hilmi')
  })

  it('handles a title written without its dot', () => {
    expect(firstNameOf('Dr Hilmi Songur')).toBe('Hilmi')
  })

  it('strips stacked Turkish academic and medical titles', () => {
    expect(firstNameOf('Prof. Dr. Ayşe Kaya')).toBe('Ayşe')
    expect(firstNameOf('Op. Dr. Mehmet Öz')).toBe('Mehmet')
    expect(firstNameOf('Yrd. Doç. Dr. Elif Demir')).toBe('Elif')
    expect(firstNameOf('Uzm. Dr. Can Yılmaz')).toBe('Can')
  })

  it('matches a title whether or not its diacritics survived', () => {
    expect(firstNameOf('Doç. Ali Vural')).toBe('Ali')
    expect(firstNameOf('Doc. Ali Vural')).toBe('Ali')
    expect(firstNameOf('Müh. Burak Şahin')).toBe('Burak')
  })

  it('leaves an ordinary name alone', () => {
    expect(firstNameOf('Hilmi Songur')).toBe('Hilmi')
    expect(firstNameOf('İbrahim Kayış')).toBe('İbrahim')
    expect(firstNameOf('McKenzie Bell')).toBe('McKenzie')
  })

  it('does not mistake a trailing word for a title', () => {
    // "Op" is a title in front of a name and a surname behind one.
    expect(firstNameOf('Ozan Op')).toBe('Ozan')
  })

  it('keeps the title when that is the entire name', () => {
    // Better a wrong-looking greeting than a blank one.
    expect(firstNameOf('Dr.')).toBe('Dr.')
  })

  it('collapses stray whitespace', () => {
    expect(firstNameOf('  Ece   Yıldız  ')).toBe('Ece')
  })

  it('returns empty for a missing name so callers can fall back', () => {
    expect(firstNameOf('')).toBe('')
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf(undefined)).toBe('')
  })
})

describe('getInitials', () => {
  it('ignores the title', () => {
    expect(getInitials('Dr. Hilmi Songur')).toBe('HS')
    expect(getInitials('Prof. Dr. Ayşe Kaya')).toBe('AK')
  })

  it('is unchanged for names without one', () => {
    expect(getInitials('Hilmi Songur')).toBe('HS')
    expect(getInitials('Aisha K.')).toBe('AK')
  })

  it('survives an empty name', () => {
    expect(getInitials('')).toBe('')
  })
})

describe('formatName', () => {
  // Guarding the neighbouring util: it must stay conservative, because no
  // single locale can lower-case an ALL-CAPS name safely for both Turkish
  // and Latin members.
  it('upper-cases a leading lowercase letter only', () => {
    expect(formatName('hilmi songur')).toBe('Hilmi Songur')
  })

  it('never de-shouts, and never touches interior casing', () => {
    expect(formatName('KAYIŞ')).toBe('KAYIŞ')
    expect(formatName('McKenzie')).toBe('McKenzie')
  })
})
