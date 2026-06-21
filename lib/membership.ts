// Membership tiers. Stored on User.membershipType: 'free' (default /
// standard), 'premium', 'vip'. Centralized so the badge label + premium
// check stay consistent across the admin panel, directory, profile, and
// digital card. Granted by admins (no self-serve payment yet).

export const MEMBERSHIP_TYPES = ['free', 'premium', 'vip'] as const
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number]

/** Display label for paid tiers, or null for free/standard (no badge). */
export function membershipTierLabel(membershipType?: string | null): 'Premium' | 'VIP' | null {
  if (membershipType === 'vip') return 'VIP'
  if (membershipType === 'premium') return 'Premium'
  return null
}

/** True for any paid tier (premium or vip). */
export function isPremium(membershipType?: string | null): boolean {
  return membershipType === 'premium' || membershipType === 'vip'
}
