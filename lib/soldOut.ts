// Whether an event is closed to new joins.
//
// Two things can close a door and they were being combined ad hoc: the spot
// counter running out, and someone saying so. The counter rule alone
// (`limitedSpots && spotsLeft <= 0`) was written out by hand in the homepage,
// the city page, the events query and the card, which is three chances too
// many for them to disagree — and none of them knew about a manual flag.
//
// Pure and client-safe: the card, the detail page and the RSVP route all
// import it, and the last of those is the one that must agree with the badge.
// A "Sold out" banner over a working Join button is worse than no banner.

export interface SoldOutFields {
  soldOut?:      boolean | null
  limitedSpots?: boolean | null
  spotsLeft?:    number  | null
}

export function isSoldOut(event: SoldOutFields): boolean {
  if (event.soldOut) return true
  return !!event.limitedSpots && (event.spotsLeft ?? 0) <= 0
}

/**
 * True when a human set the flag while spots remain on paper.
 *
 * Worth distinguishing because the counter can't explain itself: an event at
 * 0/20 is self-evidently full, whereas one marked sold out at 12/20 needs the
 * interface to say a person decided that — otherwise the remaining spots read
 * as a bug.
 */
export function isManuallySoldOut(event: SoldOutFields): boolean {
  return !!event.soldOut && !(!!event.limitedSpots && (event.spotsLeft ?? 0) <= 0)
}
