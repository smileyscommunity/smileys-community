// Shared check-in helpers used by both /admin/checkin and /host/checkin.
// The two pages still own their own list rendering (tap-to-toggle vs
// SwipeRow gestures + the desktop vs kiosk layouts diverge enough that
// a full component extraction isn't a win), but the QR parse, haptic
// patterns, and toast vocabulary were duplicated and had drifted.

import { type Dispatch, type SetStateAction, useState, useRef, useEffect, useCallback } from 'react'
import { patchCheckin, type SendOutcome } from '@/lib/checkinQueue'
// The shape only, never lib/cardToken itself: that one signs and verifies,
// so it imports node's crypto, and importing it from this hook put 325 KB of
// crypto-browserify on the door page.
import { readCardTokenExp, readCardTokenUserId } from '@/lib/cardTokenShape'

export interface ParsedCheckinQR {
  /** Who the code says it is — enough to find them on the roster, nothing more. */
  userId:    string
  /** The exact string that came off the camera, for the server to verify. */
  cardToken: string
}

/**
 * Parses a check-in QR code value.
 *
 * Three formats are recognised:
 *   - `smileys:card:{userId}.{exp}.{sig}` — the member card. Signed and
 *     good for a day (lib/cardToken); only the server can check that, so
 *     here we read the id out of it for the roster look-up and nothing else.
 *   - `smileys:member:{userId}` — the card's retired shape: a bare id,
 *     unsigned, valid for ever. Anyone could draw one.
 *   - `smileys-checkin:{eventId}:{userId}` — the retired per-event code
 *     that /my-events used to mint. Bound to an event, so a mismatched
 *     event id is not this event's code.
 *
 * The two retired shapes still parse because they are still out there, in
 * screenshots and in pages cached on people's phones — parsing them is what
 * lets the door say "that card is out of date" with a name attached instead
 * of "invalid code". The server refuses them on the write (`card_outdated`).
 *
 * The raw value rides along because the PATCH has to send it: the id alone
 * proves nothing, and the signature is the whole point.
 */
export function parseCheckinQR(raw: string, eventId: string): ParsedCheckinQR | null {
  // Tolerate stray whitespace from copy/paste or scanner artefacts.
  const value = raw.trim()

  const carded = readCardTokenUserId(value)
  if (carded) return { userId: carded, cardToken: value }

  const parts = value.split(':')
  if (parts[0] === 'smileys' && parts[1] === 'member' && parts[2]) {
    return { userId: parts[2], cardToken: value }
  }
  if (parts[0] === 'smileys-checkin' && parts[1] === eventId && parts[2]) {
    return { userId: parts[2], cardToken: value }
  }
  return null
}

/**
 * A seat at this event, as opposed to a waitlist place or an unanswered
 * request. The roster carries all three now, so both door screens have to ask
 * this before counting a row, listing it, or closing the night out on it.
 *
 * `listed` is the server's own word for it; the status fallback is for a
 * roster that predates the field — one saved on a phone (lib/hostPanel) or
 * still in flight — where a row with no status at all is a seat.
 */
export function isSeated(a: { status?: string; listed?: boolean }): boolean {
  return a.listed ?? (a.status === undefined || a.status === 'approved')
}

/**
 * Haptic feedback for check-in interactions. No-ops on devices without
 * a vibration motor (desktop, iOS Safari) via the optional-chain on
 * navigator.vibrate. The patterns match the previous host-page values
 * so muscle memory carries over.
 */
export const vibrate = {
  /** ~3-pulse celebratory tap for a successful check-in. */
  success:          () => navigator.vibrate?.([50, 30, 80]),
  /** Two longer pulses signalling rejection (invalid / not on list). */
  error:            () => navigator.vibrate?.([100, 50, 100]),
  /** Single short tap acknowledging an already-checked-in scan. */
  alreadyCheckedIn: () => navigator.vibrate?.(40),
}

/**
 * Unified scan-result shape. /admin/checkin used to use the
 * `{type, name?}` form (5 distinct outcomes); /host/checkin used a
 * flat `{name, ok}` where `name` was overloaded to also carry the
 * "Invalid QR code" / "Check-in failed" copy. After this hook lands,
 * both pages emit this shape and `<ScanResultToast/>` renders it.
 */
export type ScanResult =
  | { type: 'success';    name: string }
  | { type: 'already';    name: string }
  /** Registered, but on the waitlist — not a seat the door can fill by scanning. */
  | { type: 'waitlisted'; name: string }
  /** Asked to come; the host hasn't approved them. */
  | { type: 'pending';    name: string }
  /** A card nobody on tonight's list is carrying. Carries what was scanned so
   *  the door can offer to seat them without closing the camera. */
  | { type: 'notfound';   userId: string; cardToken: string }
  | { type: 'invalid'  }
  /** A real card, past its day. */
  | { type: 'expired'  }
  /** One of the retired code shapes (server: `card_outdated`). */
  | { type: 'outdated' }
  | { type: 'error';      name?: string; message?: string }

/**
 * Minimal shape the hook needs from an attendee row. `status` arrives with
 * the roster: it now carries the waitlisted and the not-yet-approved as well
 * as the seated, so a scan can tell those three apart instead of calling
 * everyone who isn't holding a seat a stranger.
 */
type ScanAttendee = {
  userId:    string
  checkedIn: boolean
  status?:   string
  user:      { name: string }
}

/**
 * The refusals the door has its own words for: a card past its day, a code
 * that isn't a card, and one of the retired shapes still living in
 * screenshots. The server sends a machine code beside its message; the
 * queue's SendOutcome doesn't carry it yet, so it's read defensively and a
 * refusal without one keeps the server's own sentence.
 */
function cardRefusal(outcome: SendOutcome): ScanResult | null {
  if (outcome.kind !== 'refused') return null
  const code = (outcome as unknown as { code?: string }).code
  if (code === 'card_expired')  return { type: 'expired'  }
  if (code === 'card_invalid')  return { type: 'invalid'  }
  if (code === 'card_outdated') return { type: 'outdated' }
  return null
}

/**
 * Owns the scan flow that both pages used to hand-roll: parse the QR,
 * look the person up, decide what the door is told about them (checked in,
 * already in, on the waitlist, not approved, not on the list, or a card that
 * is expired, out of date or not a card at all), PATCH the server, vibrate,
 * and emit the scan result. Caller drives the list rendering and the
 * QRScanner mount (the hook just exposes `scanning` + `setScanning`).
 *
 * `onCheckinSuccess` fires after the PATCH lands so callers can flash
 * a "last checked in" highlight or trigger any UI side-effect.
 *
 * Returns the unified `scanResult` plus a stable `handleScan` for the
 * <QRScanner> onScan prop. The toast timer is owned by the hook and
 * cleared on unmount — no setState-after-unmount on a kiosk that's
 * been running for hours.
 */
export function useScanCheckin<A extends ScanAttendee>(params: {
  eventId:           string
  attendees:         A[]
  setAttendees:      Dispatch<SetStateAction<A[]>>
  onCheckinSuccess?: (userId: string) => void
  toastDurationMs?:  number
  /**
   * Queue-aware sender (hooks/useCheckinSync). Without it, a scan PATCHes
   * directly. `cardToken` is the raw scanned string: the server verifies its
   * signature and refuses a forged, expired or retired code, so a scan must
   * always pass it on. A host's own tap on the list sends none.
   */
  send?:             (userId: string, checkedIn: boolean, cardToken?: string) => Promise<SendOutcome>
}) {
  const { eventId, attendees, setAttendees, onCheckinSuccess, toastDurationMs = 3000, send } = params

  const [scanning,   setScanning]   = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)

  // Timer ref so each new result cancels the previous toast hide and
  // the unmount cleanup catches whatever's pending. Using a ref keeps
  // the timer outside React's render cycle.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback((r: ScanResult) => {
    setScanResult(r)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setScanResult(null), toastDurationMs)
  }, [toastDurationMs])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // The camera stays up. It used to close on every read, so a room of thirty
  // was thirty camera cold-starts, each a second or two of black screen with
  // the next person already holding their phone out. QRScanner ignores a
  // repeat of the same code, and the host closes it when the door is done.
  const handleScan = useCallback(async (raw: string) => {
    const parsed = parseCheckinQR(raw, eventId)
    if (!parsed) {
      vibrate.error()
      flash({ type: 'invalid' })
      return
    }
    const { userId, cardToken } = parsed

    // A card past its day, read off the code itself. The server refuses it
    // too, but at a door with no signal that refusal arrives hours later,
    // from a queue draining in someone's pocket, long after the person was
    // waved in on a green toast. Said here it costs one line: the host taps
    // them on the list instead, which carries no card and always works.
    const exp = readCardTokenExp(cardToken)
    if (exp !== null && exp <= Date.now()) {
      vibrate.error()
      flash({ type: 'expired' })
      return
    }

    const attendee = attendees.find(a => a.userId === userId)
    if (!attendee) {
      vibrate.error()
      flash({ type: 'notfound', userId, cardToken })
      return
    }

    // Registered, just not in a seat. Both of these used to read "Not
    // registered for this event", which is untrue and sends the wrong person
    // away from the door.
    if (attendee.status === 'waitlisted') {
      vibrate.error()
      flash({ type: 'waitlisted', name: attendee.user.name })
      return
    }
    if (attendee.status === 'pending') {
      vibrate.error()
      flash({ type: 'pending', name: attendee.user.name })
      return
    }

    if (attendee.checkedIn) {
      vibrate.alreadyCheckedIn()
      flash({ type: 'already', name: attendee.user.name })
      return
    }

    // Optimistic check-in. The PATCH is awaited so a 500 rolls the
    // attendee row back — both pages used to fire-and-forget the
    // request, claim success in the toast, and leave the row visually
    // checked-in even if the server rejected.
    setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: true } : a))
    // Either way the scanned string goes with it: the queue-less path used to
    // drop it, which is an unverified check-in written by whatever the camera
    // happened to read.
    const outcome = send
      ? await send(userId, true, cardToken)
      : await patchCheckin(eventId, userId, true, undefined, cardToken)
    // With a queue-aware `send` (hooks/useCheckinSync), no signal is not a
    // failure: the scan waits on the device and the person is in. Without
    // one, nothing was saved. A refusal is rolled back either way, with the
    // server's reason (e.g. attendance already settled) on the toast.
    if (outcome.kind === 'refused' || (outcome.kind === 'offline' && !send)) {
      setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: false } : a))
      vibrate.error()
      flash(cardRefusal(outcome) ?? {
        type: 'error', name: attendee.user.name,
        message: outcome.kind === 'refused' ? outcome.error : 'No connection — the check-in was not saved.',
      })
      return
    }
    vibrate.success()
    flash({ type: 'success', name: attendee.user.name })
    onCheckinSuccess?.(userId)
  }, [eventId, attendees, setAttendees, onCheckinSuccess, flash, send])

  return { scanning, setScanning, scanResult, handleScan }
}
