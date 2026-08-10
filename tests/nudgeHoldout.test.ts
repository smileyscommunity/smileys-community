import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { isNudgeHoldout } from '@/lib/firstRsvpNudge'

// cuid-ish ids, close enough in shape to what Prisma generates.
const ids = Array.from({ length: 4000 }, (_, i) =>
  'c' + createHash('md5').update(`member-${i}`).digest('hex').slice(0, 24))

describe('first-RSVP nudge holdout', () => {
  it('is stable for a given member', () => {
    for (const id of ids.slice(0, 50)) {
      expect(isNudgeHoldout(id)).toBe(isNudgeHoldout(id))
    }
  })

  it('splits roughly in half', () => {
    const held = ids.filter(isNudgeHoldout).length
    const share = held / ids.length
    // Binomial noise over 4000 draws is ~±1.6% at 3 sigma; 45–55% is generous
    // enough never to flake while still catching a broken bucketing function.
    expect(share).toBeGreaterThan(0.45)
    expect(share).toBeLessThan(0.55)
  })

  it('separates members rather than assigning everyone the same arm', () => {
    expect(ids.some(isNudgeHoldout)).toBe(true)
    expect(ids.some(id => !isNudgeHoldout(id))).toBe(true)
  })

  it('matches the SQL formula documented in firstRsvpNudge.ts', () => {
    // The comment there tells analysts to reproduce the arm with:
    //   (('x' || substr(md5('first-rsvp-nudge-v1' || id), 1, 6))::bit(24)::int) % 2 = 1
    // Postgres reads those 6 hex chars as a 24-bit integer; parity therefore
    // rests on the final hex digit. If this drifts, saved analyses silently
    // start comparing the wrong groups.
    for (const id of ids.slice(0, 200)) {
      const hex = createHash('md5').update('first-rsvp-nudge-v1' + id).digest('hex')
      const sqlSaysHoldout = parseInt(hex.slice(0, 6), 16) % 2 === 1
      expect(isNudgeHoldout(id)).toBe(sqlSaysHoldout)
    }
  })
})
