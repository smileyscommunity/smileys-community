import { describe, it, expect } from 'vitest'
import { splitLeadingEmoji, stripDupTrailingEmoji } from '../lib/data'

// Event titles typed with a leading emoji ("💬 Let's Get Social") render
// doubled everywhere because every surface shows the emoji field next to
// the title. splitLeadingEmoji moves the emoji out so the create/update
// APIs can use it as the emoji-field fallback.
describe('splitLeadingEmoji', () => {
  it('splits a plain leading emoji', () => {
    expect(splitLeadingEmoji('💬 Let’s Get Social')).toEqual({ emoji: '💬', title: 'Let’s Get Social' })
  })

  it('handles ZWJ sequences (🧘‍♀️)', () => {
    expect(splitLeadingEmoji('🧘‍♀️ Meditation in Kadikoy')).toEqual({ emoji: '🧘‍♀️', title: 'Meditation in Kadikoy' })
  })

  it('handles variation selectors (⛵️)', () => {
    expect(splitLeadingEmoji('⛵️ Sunset Sailing Cruise')).toEqual({ emoji: '⛵️', title: 'Sunset Sailing Cruise' })
  })

  it('leaves plain titles alone', () => {
    expect(splitLeadingEmoji('Picnic in Moda')).toEqual({ emoji: null, title: 'Picnic in Moda' })
  })

  it('leaves a non-leading emoji in place', () => {
    expect(splitLeadingEmoji('Fenerbahçe match ⚽')).toEqual({ emoji: null, title: 'Fenerbahçe match ⚽' })
  })

  it('never empties an all-emoji title', () => {
    expect(splitLeadingEmoji('🎉')).toEqual({ emoji: null, title: '🎉' })
  })

  it('takes a whole leading run', () => {
    expect(splitLeadingEmoji('🎉🎉 Double party')).toEqual({ emoji: '🎉🎉', title: 'Double party' })
  })

  it('trims surrounding whitespace', () => {
    expect(splitLeadingEmoji('  🌳  Picnic in Moda  ')).toEqual({ emoji: '🌳', title: 'Picnic in Moda' })
  })

  it('does not treat leading digits or # as emoji', () => {
    expect(splitLeadingEmoji('5-a-side football')).toEqual({ emoji: null, title: '5-a-side football' })
    expect(splitLeadingEmoji('#1 rooftop meetup')).toEqual({ emoji: null, title: '#1 rooftop meetup' })
  })
})

// Trailing counterpart: only strips when the trailing emoji duplicates
// the emoji field; different trailing emoji are deliberate decoration.
describe('stripDupTrailingEmoji', () => {
  it('strips an exact trailing duplicate', () => {
    expect(stripDupTrailingEmoji('Let’s Get Social 💬', '💬')).toBe('Let’s Get Social')
  })

  it('matches across variation selectors (⛵️ title vs ⛵ field)', () => {
    expect(stripDupTrailingEmoji('Sunset Sailing Cruise ⛵️', '⛵')).toBe('Sunset Sailing Cruise')
  })

  it('keeps a different trailing emoji', () => {
    expect(stripDupTrailingEmoji('Picnic in Moda 🧺', '🌳')).toBe('Picnic in Moda 🧺')
    expect(stripDupTrailingEmoji('Afterwork Happy Hour & Chill 😎', '🍹')).toBe('Afterwork Happy Hour & Chill 😎')
  })

  it('leaves plain titles alone (still trims)', () => {
    expect(stripDupTrailingEmoji('Basketball Lovers Meetup ', '🏀')).toBe('Basketball Lovers Meetup')
  })

  it('never empties an all-emoji title', () => {
    expect(stripDupTrailingEmoji('💬', '💬')).toBe('💬')
  })

  it('handles a missing emoji field', () => {
    expect(stripDupTrailingEmoji('Happy Hour 🍸', null)).toBe('Happy Hour 🍸')
  })
})
