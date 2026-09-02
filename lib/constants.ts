// Single source of truth for role and status string literals used across
// the app. Import these instead of writing raw strings so a typo becomes
// a compile-time error rather than a silent auth bypass.

// Brand accent (Tailwind amber-500). Use the `amber-500` Tailwind class in
// JSX/CSS where possible; this hex constant is for the contexts that can't
// take a class — `themeColor` metadata, the root global-error boundary,
// and as the fallback for dynamic per-user colors.
export const BRAND_AMBER = '#f59e0b'

export const Role = {
  Admin:     'admin',
  Moderator: 'moderator',
  Member:    'member',
  Host:      'host',
  Partner:   'partner',
} as const
export type Role = typeof Role[keyof typeof Role]

export const UserStatus = {
  Active:    'active',
  Approved:  'approved',
  Pending:   'pending',
  Rejected:  'rejected',
  Banned:    'banned',
  Suspended: 'suspended',
  Deactivated: 'deactivated',
} as const
export type UserStatus = typeof UserStatus[keyof typeof UserStatus]

export const ApplicationStatus = {
  Pending:    'pending',
  Approved:   'approved',
  Rejected:   'rejected',
  MoreInfo:   'more_info',
} as const
export type ApplicationStatus = typeof ApplicationStatus[keyof typeof ApplicationStatus]

export const MembershipStatus = {
  Pending:  'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const
export type MembershipStatus = typeof MembershipStatus[keyof typeof MembershipStatus]

export const MembershipRole = {
  Member: 'member',
  Host:   'host',
} as const
export type MembershipRole = typeof MembershipRole[keyof typeof MembershipRole]

export const EventStatus = {
  Draft:     'draft',
  Pending:   'pending',
  Approved:  'approved',
  Rejected:  'rejected',
  Cancelled: 'cancelled',
} as const
export type EventStatus = typeof EventStatus[keyof typeof EventStatus]

// EventAttendee.status. Rows are never deleted on cancel any more: the
// two soft-cancel values keep the row (and the moment it happened) so the
// no-show policy can tell a timely cancel from a late one. ('waitlisted'
// used to be listed here but was never stored — the waitlist is its own
// table.)
export const AttendeeStatus = {
  Approved:  'approved',
  Pending:   'pending',
  Cancelled: 'cancelled',   // withdrawn by the member
  Removed:   'removed',     // taken off by a host or admin
} as const
export type AttendeeStatus = typeof AttendeeStatus[keyof typeof AttendeeStatus]

// EventAttendee.attendance — the settled outcome, separate from the
// door-side checkedIn toggle so a later cancel/removal can't erase it.
export const Attendance = {
  Unknown:  'unknown',
  Attended: 'attended',
  NoShow:   'no_show',
} as const
export type Attendance = typeof Attendance[keyof typeof Attendance]

// City status lives in lib/cities.ts (CITY_STATUS), next to the query helpers
// that enforce which statuses are public and which get statistics. The version
// that used to live here said 'active' | 'paused' — neither value the database
// has ever stored — so anything importing it was silently comparing against
// strings that never match.
