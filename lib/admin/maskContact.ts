import type { SessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/access'

// Moderators see who a member is, not how to reach them outside the app.
// The users roster has masked email/phone for moderators since the
// city-scope sweep; the other moderator-reachable lists (retention,
// listings, moving sales, messages, no-show cards, directory submitters /
// claimants / reporters) returned full addresses. One rule, same shape as
// the users route: "abc...@domain" and "+905...42".
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return email ?? null
  const [local, domain] = email.split('@')
  return `${local.slice(0, 3)}...@${domain ?? ''}`
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return phone ?? null
  return `${phone.slice(0, 4)}...${phone.slice(-2)}`
}

/** `email` as this viewer may see it. */
export function emailFor(session: SessionUser, email: string | null | undefined): string | null {
  return isAdmin(session) ? (email ?? null) : maskEmail(email)
}

/** Rewrites `<key>.email` on each row for a non-admin viewer; admins get rows back untouched. */
export function maskRows<T extends Record<string, unknown>>(session: SessionUser, rows: T[], key: string): T[] {
  if (isAdmin(session)) return rows
  return rows.map(row => {
    const person = row[key]
    if (!person || typeof person !== 'object' || !('email' in person)) return row
    return { ...row, [key]: { ...(person as Record<string, unknown>), email: maskEmail((person as { email?: string | null }).email) } }
  })
}
