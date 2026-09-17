import { describe, it, expect } from 'vitest'
import {
  eventTier, cancelCutoffHours, lateCancelLine, classifyRow, refilledLateCancels, offenceCounts,
  decideIssuance, isSuccessfulCommitment, countedCommitments, recoveryOutcome, cardLapsed,
  standingLevel, needsHostApproval, orderWaitlist, canDispute,
  CANCEL_CUTOFF_HOURS, NEW_CITY_GRACE_DAYS, STANDING_WINDOW_DAYS, CARD_LAPSE_DAYS, DISPUTE_WINDOW_DAYS,
  type StandingRow, type LedgerOffence,
} from '@/lib/standingPolicy'

// The standing rules on their own: tiers, what an RSVP row counts as, when a
// card is issued, escalated, cleared or lapses, and what it changes.

const H = 60 * 60 * 1000
const D = 24 * H
const START = new Date('2026-10-01T16:00:00Z')
const runners = { hostId: 'host', cohostIds: ['co'], clubHostIds: ['clubhost'] }

const row = (over: Partial<StandingRow> = {}): StandingRow => ({
  id: 'r1', userId: 'm1', status: 'approved', checkedIn: false, attendance: 'unknown',
  joinedAt: new Date(START.getTime() - 5 * D), cancelledAt: null, cancelledBy: null,
  reconfirmAskedAt: null, user: { role: 'member' }, ...over,
})

describe('tier and cutoff', () => {
  it('limited spots is scarce at any size; no cap is open', () => {
    expect(eventTier({ limitedSpots: true,  totalSpots: 8 })).toBe('scarce')
    // Let's Get Social: 50–76 seats, fills up, has a waitlist.
    expect(eventTier({ limitedSpots: true,  totalSpots: 60 })).toBe('scarce')
    expect(eventTier({ limitedSpots: false, totalSpots: 8 })).toBe('open')
  })
  it('a host override wins both ways', () => {
    expect(eventTier({ limitedSpots: false, totalSpots: 60, tierOverride: 'scarce' })).toBe('scarce')
    expect(eventTier({ limitedSpots: true, totalSpots: 8,  tierOverride: 'open' })).toBe('open')
    expect(eventTier({ limitedSpots: true, totalSpots: 8,  tierOverride: 'bogus' })).toBe('scarce')
  })
  it('cutoff follows the tier unless the event sets its own', () => {
    expect(cancelCutoffHours({ limitedSpots: true, totalSpots: 8 })).toBe(CANCEL_CUTOFF_HOURS.scarce)
    expect(cancelCutoffHours({ limitedSpots: false, totalSpots: 20 })).toBe(CANCEL_CUTOFF_HOURS.open)
    expect(cancelCutoffHours({ limitedSpots: true, totalSpots: 8, cancelCutoffHours: 72 })).toBe(72)
    expect(lateCancelLine(START, { limitedSpots: true, totalSpots: 8 })).toEqual(new Date(START.getTime() - 24 * H))
  })
})

describe('classifyRow', () => {
  const scarce = { limitedSpots: true, totalSpots: 8 }
  const open   = { limitedSpots: false, totalSpots: 60 }

  it('a host-declared no-show is a no-show; an unresolved or attended RSVP is nothing', () => {
    expect(classifyRow(row({ attendance: 'no_show' }), START, scarce, runners)).toBe('no_show')
    expect(classifyRow(row({ attendance: 'attended' }), START, scarce, runners)).toBeNull()
    expect(classifyRow(row({ attendance: 'unknown' }), START, scarce, runners)).toBeNull()
  })

  it('a scan always wins, and the people running it or staff are never offenders', () => {
    expect(classifyRow(row({ attendance: 'no_show', checkedIn: true }), START, scarce, runners)).toBeNull()
    for (const userId of ['host', 'co', 'clubhost']) {
      expect(classifyRow(row({ userId, attendance: 'no_show' }), START, scarce, runners)).toBeNull()
    }
    expect(classifyRow(row({ attendance: 'no_show', user: { role: 'moderator' } }), START, scarce, runners)).toBeNull()
  })

  it('a member cancel after the tier cutoff is late: 24h on scarce, 2h on open', () => {
    const cancel = (hoursBefore: number) => row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: new Date(START.getTime() - hoursBefore * H) })
    expect(classifyRow(cancel(25), START, scarce, runners)).toBeNull()
    expect(classifyRow(cancel(23), START, scarce, runners)).toBe('late_cancel')
    expect(classifyRow(cancel(3),  START, open,   runners)).toBeNull()
    expect(classifyRow(cancel(1),  START, open,   runners)).toBe('late_cancel')
  })

  it('answering the day-before ask with a cancel is on time, up to the release point', () => {
    const asked = { status: 'cancelled', cancelledBy: 'member', reconfirmAskedAt: new Date(START.getTime() - 24 * H) }
    expect(classifyRow(row({ ...asked, cancelledAt: new Date(START.getTime() - 20 * H) }), START, scarce, runners)).toBeNull()
    expect(classifyRow(row({ ...asked, cancelledAt: new Date(START.getTime() - 6 * H) }), START, scarce, runners)).toBe('late_cancel')
  })

  it('the lateness recorded at the cancel wins over the event as it is now', () => {
    const early = row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: new Date(START.getTime() - 30 * H) })
    expect(classifyRow({ ...early, cancelledLate: true }, START, scarce, runners)).toBe('late_cancel')
    const late = row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: new Date(START.getTime() - 3 * H) })
    expect(classifyRow({ ...late, cancelledLate: false }, START, scarce, runners)).toBeNull()
  })

  it('removals by a host, an admin or the reconfirm release are never held against the member', () => {
    for (const cancelledBy of ['host', 'admin', 'system', 'withdrawn']) {
      expect(classifyRow(row({ status: cancelledBy === 'withdrawn' ? 'cancelled' : 'removed', cancelledBy, cancelledAt: new Date(START.getTime() - H) }), START, scarce, runners)).toBeNull()
    }
  })
})

describe('refilledLateCancels', () => {
  const at = (h: number) => new Date(START.getTime() - h * H)
  it('forgives one late cancel per later arrival who came, earliest first', () => {
    const cancels  = [{ id: 'a', cancelledAt: at(10) }, { id: 'b', cancelledAt: at(5) }]
    const arrivals = [{ joinedAt: at(8), checkedIn: true }, { joinedAt: at(12), checkedIn: true }, { joinedAt: at(4), checkedIn: false }]
    expect([...refilledLateCancels(cancels, arrivals)]).toEqual(['a'])
  })
  it('a seat nobody came for is not forgiven', () => {
    expect(refilledLateCancels([{ id: 'a', cancelledAt: at(10) }], []).size).toBe(0)
  })
})

describe('offenceCounts', () => {
  const city = new Date('2026-01-01T00:00:00Z')
  it('open events are logged, never carded', () => {
    expect(offenceCounts('open', city, START)).toEqual({ counts: false, loggedReason: 'open_tier' })
  })
  it('a city\'s first 90 days are logged', () => {
    const young = new Date(START.getTime() - (NEW_CITY_GRACE_DAYS - 1) * D)
    expect(offenceCounts('scarce', young, START)).toEqual({ counts: false, loggedReason: 'new_city' })
    expect(offenceCounts('scarce', city, START)).toEqual({ counts: true, loggedReason: null })
  })
})

describe('decideIssuance', () => {
  const NOW = new Date('2026-10-20T12:00:00Z')
  const off = (id: string, daysAgo: number, over: Partial<LedgerOffence> = {}): LedgerOffence =>
    ({ id, occurredAt: new Date(NOW.getTime() - daysAgo * D), counts: true, status: 'open', cardId: null, ...over })

  it('one offence is nothing; two inside the window is a yellow on the second', () => {
    expect(decideIssuance([off('a', 5)], null, NOW, false)).toEqual({ kind: 'none' })
    expect(decideIssuance([off('b', 2), off('a', 5)], null, NOW, false))
      .toEqual({ kind: 'yellow', offenceIds: ['a', 'b'], triggeredAt: off('b', 2).occurredAt })
  })

  it('logged, overturned, disputed, already-carded and out-of-window offences never count', () => {
    const noise = [
      off('logged', 3, { counts: false }), off('over', 3, { status: 'overturned' }),
      off('disp', 3, { status: 'disputed' }), off('used', 3, { cardId: 'old' }),
      off('old', STANDING_WINDOW_DAYS + 1),
    ]
    expect(decideIssuance([...noise, off('a', 1)], null, NOW, false)).toEqual({ kind: 'none' })
  })

  it('a pending dispute holds any card back', () => {
    expect(decideIssuance([off('a', 5), off('b', 2)], null, NOW, true)).toEqual({ kind: 'none' })
  })

  it('a further offence after the yellow escalates it; one before it does not', () => {
    const yellow = { id: 'y', level: 'yellow', status: 'active', triggeredAt: new Date(NOW.getTime() - 4 * D) }
    expect(decideIssuance([off('c', 1)], yellow, NOW, false))
      .toEqual({ kind: 'escalate', fromCardId: 'y', offenceIds: ['c'], triggeredAt: off('c', 1).occurredAt })
    expect(decideIssuance([off('early', 6)], yellow, NOW, false)).toEqual({ kind: 'none' })
  })

  it('a red keeps further offences on its record without stacking a card', () => {
    const red = { id: 'r', level: 'red', status: 'active', triggeredAt: new Date(NOW.getTime() - 4 * D) }
    expect(decideIssuance([off('d', 1), off('e', 2)], red, NOW, false)).toEqual({ kind: 'attach', cardId: 'r', offenceIds: ['e', 'd'] })
  })
})

describe('recovery', () => {
  const card = { triggeredAt: START }
  const after = new Date(START.getTime() + 3 * D)
  const ends  = new Date(after.getTime() + 3 * H)
  const NOW   = new Date(after.getTime() + 2 * D)

  it('a successful commitment is a scanned, approved RSVP at an event after the card, that has ended', () => {
    expect(isSuccessfulCommitment({ status: 'approved', checkedIn: true, attendance: 'attended' }, after, ends, card, NOW)).toBe(true)
    // Resolved by nobody: host inaction earns no credit.
    expect(isSuccessfulCommitment({ status: 'approved', checkedIn: false, attendance: 'attended' }, after, ends, card, NOW)).toBe(false)
    expect(isSuccessfulCommitment({ status: 'approved', checkedIn: true, attendance: 'attended' }, START, ends, card, NOW)).toBe(false)
    expect(isSuccessfulCommitment({ status: 'approved', checkedIn: true, attendance: 'attended' }, after, new Date(NOW.getTime() + H), card, NOW)).toBe(false)
    expect(isSuccessfulCommitment({ status: 'cancelled', checkedIn: true, attendance: 'attended' }, after, ends, card, NOW)).toBe(false)
  })

  it('yellow clears at two, at most one of them a contribution', () => {
    const active = { level: 'yellow', status: 'active' }
    expect(recoveryOutcome(active, { attendance: 1, contributions: 0 })).toBeNull()
    expect(recoveryOutcome(active, { attendance: 2, contributions: 0 })).toBe('cleared')
    expect(recoveryOutcome(active, { attendance: 1, contributions: 1 })).toBe('cleared')
    expect(recoveryOutcome(active, { attendance: 0, contributions: 2 })).toBeNull()
    expect(countedCommitments('yellow', { attendance: 0, contributions: 2 })).toBe(1)
  })

  it('red is up for review after three attendances; contributions do not substitute', () => {
    const red = { level: 'red', status: 'active' }
    expect(recoveryOutcome(red, { attendance: 2, contributions: 5 })).toBeNull()
    expect(recoveryOutcome(red, { attendance: 3, contributions: 0 })).toBe('review')
    expect(recoveryOutcome({ level: 'red', status: 'review' }, { attendance: 9, contributions: 0 })).toBeNull()
  })

  it('a card lapses after the quiet period, measured from the latest activity', () => {
    const issuedAt = new Date('2026-01-01T00:00:00Z')
    const late = new Date(issuedAt.getTime() + (CARD_LAPSE_DAYS + 1) * D)
    expect(cardLapsed({ issuedAt }, null, late)).toBe(true)
    expect(cardLapsed({ issuedAt }, new Date(late.getTime() - 10 * D), late)).toBe(false)
  })
})

describe('effects', () => {
  it('shadow cards and enforcement-off count for nothing', () => {
    const red = { level: 'red', status: 'active', shadow: false }
    expect(standingLevel([red], false)).toBe('good')
    expect(standingLevel([{ ...red, shadow: true }], true)).toBe('good')
    expect(standingLevel([red, { level: 'yellow', status: 'active', shadow: false }], true)).toBe('red')
    expect(standingLevel([{ ...red, status: 'review' }], true)).toBe('red')
    expect(standingLevel([{ ...red, status: 'cleared' }], true)).toBe('good')
  })

  it('only a red card on a scarce event needs the host', () => {
    expect(needsHostApproval('red', 'scarce')).toBe(true)
    expect(needsHostApproval('red', 'open')).toBe(false)
    expect(needsHostApproval('yellow', 'scarce')).toBe(false)
  })

  it('scarce waitlists put good standing first, first-come within each group', () => {
    const q = [{ userId: 'y1' }, { userId: 'g1' }, { userId: 'r1' }, { userId: 'g2' }]
    const levels = new Map([['y1', 'yellow' as const], ['r1', 'red' as const]])
    expect(orderWaitlist(q, levels, 'scarce').map(x => x.userId)).toEqual(['g1', 'g2', 'y1', 'r1'])
    expect(orderWaitlist(q, levels, 'open').map(x => x.userId)).toEqual(['y1', 'g1', 'r1', 'g2'])
  })

  it('"I was there" is for an open no-show inside the window', () => {
    const NOW = new Date(START.getTime() + 2 * D)
    expect(canDispute({ kind: 'no_show', status: 'open', occurredAt: START }, NOW)).toBe(true)
    expect(canDispute({ kind: 'late_cancel', status: 'open', occurredAt: START }, NOW)).toBe(false)
    expect(canDispute({ kind: 'no_show', status: 'disputed', occurredAt: START }, NOW)).toBe(false)
    // Upheld and back to open: not a second time.
    expect(canDispute({ kind: 'no_show', status: 'open', occurredAt: START, disputedAt: START }, NOW)).toBe(false)
    expect(canDispute({ kind: 'no_show', status: 'open', occurredAt: START }, new Date(START.getTime() + (DISPUTE_WINDOW_DAYS + 1) * D))).toBe(false)
  })
})
