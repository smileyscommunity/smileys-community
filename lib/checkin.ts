// Shared check-in helpers used by both /admin/checkin and /host/checkin.
// The two pages still own their own list rendering (tap-to-toggle vs
// SwipeRow gestures + the desktop vs kiosk layouts diverge enough that
// a full component extraction isn't a win), but the QR parse, haptic
// patterns, and toast vocabulary were duplicated and had drifted.

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
