import { NextResponse } from 'next/server'
import { isAdminStrict } from './access'
import { ADMIN_2FA_REQUIRED } from './totpPolicy'
import type { SessionUser } from './session'

/**
 * Step-up authentication for the operations a stolen password must not buy.
 *
 * CURRENTLY DISABLED via ADMIN_2FA_REQUIRED (lib/totpPolicy.ts) — this
 * returns null for everyone until that flag goes back to true. The rest of
 * this comment describes the behaviour you get when it does.
 *
 * Returns a NextResponse to return immediately when the session hasn't proved
 * possession of the admin's TOTP device, or null when it has. Same shape as
 * checkCronAuth — guard first, then do the work.
 *
 * `isAdminStrict` has existed (and been unit-tested) since the audit, but no
 * route called it, so the whole capability was dead code: role changes, user
 * deletion and payment deletion rested on a password plus a 7-day cookie.
 * This is the missing call site.
 *
 * Deliberately NOT a lockout, even though 2FA is optional for admins:
 *   - POST /api/auth/2fa/setup uses a raw role check precisely so an admin
 *     who hasn't enrolled can still reach it (see the comment there), and
 *   - completing enrollment marks the CURRENT session totpVerified, so the
 *     admin doesn't have to log out and back in.
 * So an admin who hits this 403 enrolls once at /admin/security and comes
 * straight back with access. The `code` below is what tells the UI to say
 * that rather than render a bare "Forbidden".
 *
 * Use it for destructive or privilege-granting operations only. Routine admin
 * work (marking a payment paid, approving an application) stays on the plain
 * capability helpers — a step-up prompt on every click trains people to click
 * through it, which buys nothing.
 */
export function requireStepUp(session: SessionUser): NextResponse | null {
  // Policy switch — see lib/totpPolicy.ts. While 2FA is not required, every
  // step-up gate is a no-op and these routes fall back to the plain
  // capability check that still runs above each call site (canManageUsers,
  // canManagePayments, …) — so they stay admin-only, they just no longer
  // ask for a second factor. Kept wired rather than deleted so restoring
  // enforcement is one line in totpPolicy.ts.
  if (!ADMIN_2FA_REQUIRED) return null
  if (isAdminStrict(session)) return null
  return NextResponse.json(
    {
      // The admin pages toast `error` verbatim, so it has to say what to do,
      // not just that the door is shut.
      error: 'Two-factor verification required — set up 2FA in Admin → Security, then retry',
      code:  'totp_required',
    },
    { status: 403 },
  )
}
