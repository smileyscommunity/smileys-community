// Shared check-in helpers used by both /admin/checkin and /host/checkin.
// The two pages still own their own list rendering (tap-to-toggle vs
// SwipeRow gestures + the desktop vs kiosk layouts diverge enough that
// a full component extraction isn't a win), but the QR parse, haptic
// patterns, and toast vocabulary were duplicated and had drifted.

import { type Dispatch, type SetStateAction, useState, useRef, useEffect, useCallback } from 'react'

/**
 * Parses a check-in QR code value into a userId.
 *
 * Two formats are supported:
 *   - `smileys:member:{userId}` — the canonical member card. Works at
 *     any event; the caller decides whether the user is registered.
 *   - `smileys-checkin:{eventId}:{userId}` — legacy event-specific QR
 *     that older flows still circulate. The host page accepted these,
 *     the admin page didn't, so old codes silently failed on /admin/
 *     checkin. Bound to a specific event so we require the caller to
 *     pass the active eventId; mismatched event ids return null.
 *
 * Returns the userId on a clean parse, or null on anything else.
 */
export function parseCheckinQR(raw: string, eventId: string): string | null {
  // Tolerate stray whitespace from copy/paste or scanner artefacts.
  const value = raw.trim()
  const parts = value.split(':')

  if (parts[0] === 'smileys' && parts[1] === 'member' && parts[2]) {
    return parts[2]
  }
  if (parts[0] === 'smileys-checkin' && parts[1] === eventId && parts[2]) {
    return parts[2]
  }
  return null
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
  | { type: 'success';   name: string }
  | { type: 'already';   name: string }
  | { type: 'notfound' }
  | { type: 'invalid'  }
  | { type: 'error';     name?: string }

/** Minimal shape the hook needs from an attendee row. */
type ScanAttendee = { userId: string; checkedIn: boolean; user: { name: string } }

/**
 * Owns the scan flow that both pages used to hand-roll: parse the QR,
 * look the attendee up, decide success / already / not-found / invalid,
 * PATCH the server, vibrate, and emit the scan result. Caller drives
 * the list rendering and the QRScanner mount (the hook just exposes
 * `scanning` + `setScanning`).
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
}) {
  const { eventId, attendees, setAttendees, onCheckinSuccess, toastDurationMs = 3000 } = params

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

  const handleScan = useCallback(async (raw: string) => {
    setScanning(false)

    const userId = parseCheckinQR(raw, eventId)
    if (!userId) {
      vibrate.error()
      flash({ type: 'invalid' })
      return
    }

    const attendee = attendees.find(a => a.userId === userId)
    if (!attendee) {
      vibrate.error()
      flash({ type: 'notfound' })
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
    try {
      const res = await fetch(`/app/api/events/${eventId}/checkin`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, checkedIn: true }),
      })
      if (!res.ok) throw new Error()
      vibrate.success()
      flash({ type: 'success', name: attendee.user.name })
      onCheckinSuccess?.(userId)
    } catch {
      setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: false } : a))
      vibrate.error()
      flash({ type: 'error', name: attendee.user.name })
    }
  }, [eventId, attendees, setAttendees, onCheckinSuccess, flash])

  return { scanning, setScanning, scanResult, handleScan }
}
