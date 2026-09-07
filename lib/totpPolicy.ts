/**
 * Is two-factor authentication REQUIRED of admins?
 *
 * One switch, read by every gate, so the policy lives in a single place
 * instead of being spread across a client layout and eight API routes:
 *
 *   - app/admin/layout.tsx  — whether an unenrolled admin is redirected to
 *                             /admin/security before they can use the panel
 *   - lib/stepUp.ts         — whether destructive/privilege-granting routes
 *                             (role change, user delete, payment delete,
 *                             club delete, city delete, newsletter blast,
 *                             broadcast) demand a TOTP-verified session
 *
 * Turned OFF on 2026-09-07 at the owner's request: forced enrollment was
 * getting in the way of day-to-day admin work.
 *
 * This does NOT remove 2FA. Enrollment still works and is still encouraged —
 * /admin/security and POST /api/auth/2fa/setup are unchanged, sessions that
 * complete TOTP verify are still marked totpVerified, and secrets are still
 * encrypted at rest. What's switched off is COMPULSION.
 *
 * What turning this off costs, stated plainly so the trade is visible at the
 * point of change: with it false, an attacker holding an admin's password and
 * a valid session cookie can delete users, change roles, delete payments and
 * blast the whole member list, because requireStepUp() no longer asks for a
 * second factor. That is the exact class of action step-up existed to stop.
 *
 * Flip to `true` to restore enforcement — nothing else needs editing, and
 * tests/stepUp.test.ts + tests/adminStepUpRoutes.test.ts still exercise the
 * enforced path (they mock this module to true) so the wiring cannot rot
 * while the switch is off.
 */
export const ADMIN_2FA_REQUIRED = false
