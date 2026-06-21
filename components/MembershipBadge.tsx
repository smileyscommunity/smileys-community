import { membershipTierLabel } from '@/lib/membership'

// Premium/VIP tier badge. Renders nothing for free/standard members.
// Size + spacing come from the caller via `className` so it fits each
// surface (directory card, modal, member page, profile, digital card).
export default function MembershipBadge({
  membershipType,
  className = 'text-[10px] px-1.5 py-0.5',
}: {
  membershipType?: string | null
  className?: string
}) {
  const label = membershipTierLabel(membershipType)
  if (!label) return null
  return (
    <span
      title={`${label} member`}
      className={`inline-flex items-center gap-0.5 font-bold rounded-full bg-gradient-to-r from-amber-400 to-amber-600 text-white shadow-sm whitespace-nowrap ${className}`}
    >
      <span aria-hidden="true">{label === 'VIP' ? '♛' : '★'}</span> {label}
    </span>
  )
}
