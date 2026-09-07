import { describe, it, expect } from 'vitest'
import { firstNameOf, getInitials, formatName } from '@/lib/data'

// Dr. Hilmi Songur joined and the whole site called him "Dr." — every
// greeting, every "X is interested in your listing", his initials. The cause
// was name.split(' ')[0] in 150 places. The first fix dropped the title and
// greeted him "Hilmi", which over-corrected: in Turkish "Dr. Hilmi" is how
// you address someone, and the bare first name presumes a familiarity a
// platform hasn't earned. So the title travels with the greeting now — and
// these pin the edges, especially the Turkish ones, where titles stack and
// casing is a trap.

describe('firstNameOf', () => {
  it('skips a leading initial when the person goes by their second name', () => {
    // "H. Kübra Çulha" was greeted as "H." on the dashboard wall (2026-09-07).
    expect(firstNameOf('H. Kübra Çulha')).toBe('Kübra')
    expect(firstNameOf('O. Alfred McCallum')).toBe('Alfred')
    expect(firstNameOf('H Kübra Çulha')).toBe('Kübra')
    expect(firstNameOf('Dr. H. Kübra Çulha')).toBe('Dr. Kübra')
  })

  it('never skips past an initial into a surname', () => {
    // With only one token after the initial, that token is the surname —
    // and "Sher" or "Smith" as a greeting is worse than the initial.
    expect(firstNameOf('R Sher')).toBe('R')
    expect(firstNameOf('J. Smith')).toBe('J.')
    expect(firstNameOf('Y. E.')).toBe('Y.')
    expect(firstNameOf('H.')).toBe('H.')
  })

  it('keeps the title in front of the person', () => {
    expect(firstNameOf('Dr. Hilmi Songur')).toBe('Dr. Hilmi')
  })

  it('handles a title written without its dot', () => {
    expect(firstNameOf('Dr Hilmi Songur')).toBe('Dr Hilmi')
  })

  it('carries stacked Turkish academic and medical titles', () => {
    expect(firstNameOf('Prof. Dr. Ayşe Kaya')).toBe('Prof. Dr. Ayşe')
    expect(firstNameOf('Op. Dr. Mehmet Öz')).toBe('Op. Dr. Mehmet')
    expect(firstNameOf('Yrd. Doç. Dr. Elif Demir')).toBe('Yrd. Doç. Dr. Elif')
    expect(firstNameOf('Uzm. Dr. Can Yılmaz')).toBe('Uzm. Dr. Can')
  })

  it('drops the courtesy titles, which need a surname to make sense', () => {
    // "Mr. John" is wrong in English — Mr. pairs with the family name or
    // with nothing. The professional titles above do not have that problem.
    expect(firstNameOf('Mr. John Smith')).toBe('John')
    expect(firstNameOf('Mrs. Jane Doe')).toBe('Jane')
    expect(firstNameOf('Ms. Ada Lovelace')).toBe('Ada')
    // Sir and Rev. read fine with a first name, so they stay.
    expect(firstNameOf('Sir Elton John')).toBe('Sir Elton')
    expect(firstNameOf('Rev. Tim Keller')).toBe('Rev. Tim')
  })

  it('matches a title whether or not its diacritics survived', () => {
    expect(firstNameOf('Doç. Ali Vural')).toBe('Doç. Ali')
    expect(firstNameOf('Doc. Ali Vural')).toBe('Doc. Ali')
    expect(firstNameOf('Müh. Burak Şahin')).toBe('Müh. Burak')
  })

  it('normalises the title too, not just the name', () => {
    expect(firstNameOf('av. ayşe kaya')).toBe('Av. Ayşe')
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

  // H.Kubra joined and the site greeted her as "h". The stored name is only
  // as tidy as whoever typed it — and the apply route, which is how nearly
  // everyone joins, wrote it through verbatim — so normalising here is what
  // fixes every greeting at once without rewriting a row.
  it('normalises what it returns instead of echoing what was typed', () => {
    expect(firstNameOf('h Kubra')).toBe('H')
    // Was 'H.' — the initial-skipping rule above now reaches the name, and
    // it still comes back capitalised.
    expect(firstNameOf('h. kubra yılmaz')).toBe('Kubra')
    expect(firstNameOf('h.kubra yılmaz')).toBe('H.Kubra')
    expect(firstNameOf('hilmi songur')).toBe('Hilmi')
  })

  it('still refuses to touch casing it cannot safely judge', () => {
    // ALL-CAPS stays — no locale lower-cases safely for both Turkish and
    // Latin names. The nightly sweeper owns that, with nationality in hand.
    expect(firstNameOf('KAYIŞ Demir')).toBe('KAYIŞ')
    expect(firstNameOf('McKenzie Bell')).toBe('McKenzie')
  })

  it('returns empty for a missing name so callers can fall back', () => {
    expect(firstNameOf('')).toBe('')
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf(undefined)).toBe('')
  })
})

describe('getInitials', () => {
  // Unchanged by the greeting change above: a title belongs in an address,
  // never in an avatar. "Dr. Hilmi Songur" is HS, not DH.
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

  // The dot is a separator like the hyphen and the apostrophe. Before this,
  // the letter after it was interior to the token, so "h.kubra" could only
  // ever reach "H.kubra" — including under the nightly sweeper, which ends
  // by calling formatName.
  it('capitalises across a dot, not just a hyphen or apostrophe', () => {
    expect(formatName('h.kubra yılmaz')).toBe('H.Kubra Yılmaz')
    expect(formatName('r.g')).toBe('R.G')
    expect(formatName('ayşe-nur o\'brien')).toBe('Ayşe-Nur O\'Brien')
  })

  it('leaves a trailing dot alone rather than treating it as a word', () => {
    expect(formatName('Dr.')).toBe('Dr.')
    expect(formatName('Aisha K.')).toBe('Aisha K.')
  })
})
