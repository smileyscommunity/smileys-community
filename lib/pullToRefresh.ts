// The gesture maths behind hooks/usePullToRefresh, kept pure so the arming
// rules are testable without a touch screen.
//
// The hook used to remember the last touch's start position forever. A touch
// that began mid-page left the previous start in place, so scrolling back up
// to the top in one ordinary swipe read as a pull from that stale point and
// refreshed the page. Now a gesture is only ARMED when its touch begins with
// the page already at the top, and the arm is dropped when the touch ends or
// is cancelled — every gesture decides for itself.

export const PULL_THRESHOLD = 72
const RESISTANCE = 0.45
const OVERSHOOT  = 16

/** The start Y to track for this touch, or null if it can't become a pull. */
export function armPull(opts: { busy: boolean; scrollY: number; clientY: number }): number | null {
  if (opts.busy || opts.scrollY > 0) return null
  return opts.clientY
}

/**
 * How far to draw the indicator for the current finger position. 0 when the
 * gesture isn't armed, is moving up, or the page has scrolled off the top.
 */
export function pullDistance(opts: { startY: number | null; clientY: number; scrollY: number }): number {
  if (opts.startY === null || opts.scrollY > 0) return 0
  const dy = opts.clientY - opts.startY
  if (dy <= 0) return 0
  return Math.min(dy * RESISTANCE, PULL_THRESHOLD + OVERSHOOT)
}
