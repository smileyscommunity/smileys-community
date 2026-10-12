// The one-time "last call" activation email (admin Retention > Not activated):
// a final, personal email with a fresh link for members approved more than 60
// days ago who never set a password. The weekly login-nudge email stops at 60
// days, so after that nothing chased them (222 people on 2026-10-13).
//
// Shared by the count on the page and the send route, so the number the admin
// sees is exactly who a press reaches. Pure: no prisma client import.

import { NOT_ACTIVATED_MEMBER_WHERE, MEMBER_ROLE_FILTER } from '@/lib/memberCount'

// The login nudge covers the first 60 days; this picks up where it stops.
export const LAST_CALL_AFTER_DAYS = 60
// Emails per press. Sent one at a time (Resend allows ~2 a second), so a batch
// finishes well inside the proxy timeout; the page shows what is left.
export const LAST_CALL_BATCH = 30

export function lastCallWhere(now: Date = new Date()) {
  return {
    ...NOT_ACTIVATED_MEMBER_WHERE,
    role: MEMBER_ROLE_FILTER,
    joinedAt: { lt: new Date(now.getTime() - LAST_CALL_AFTER_DAYS * 86_400_000) },
    // Once per member, ever: the column is set before the email goes out.
    activationLastCallAt: null,
  }
}
