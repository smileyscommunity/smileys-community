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

export const AttendeeStatus = {
  Approved:   'approved',
  Waitlisted: 'waitlisted',
  Cancelled:  'cancelled',
} as const
export type AttendeeStatus = typeof AttendeeStatus[keyof typeof AttendeeStatus]

export const CityStatus = {
  Active: 'active',
  Paused: 'paused',
} as const
export type CityStatus = typeof CityStatus[keyof typeof CityStatus]
