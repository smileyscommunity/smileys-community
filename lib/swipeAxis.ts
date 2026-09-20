// Which way a touch is going, once it has gone far enough to be sure.
//
// SwipeRow committed to the horizontal axis as soon as the finger had drifted
// 4px further sideways than downwards — well inside the wobble of a normal
// thumb scroll, so a diagonal flick down a list of notifications could commit
// to "swipe", reach the dismiss threshold and delete a row the member was only
// scrolling past. Nothing commits until one axis leads the other by a margin
// a deliberate swipe clears immediately and a scroll never does.
export const SWIPE_AXIS_LOCK_PX = 14

export function swipeAxis(deltaX: number, deltaY: number, lock: number = SWIPE_AXIS_LOCK_PX): 'h' | 'v' | null {
  const x = Math.abs(deltaX)
  const y = Math.abs(deltaY)
  if (x > y + lock) return 'h'
  if (y > x + lock) return 'v'
  return null
}
