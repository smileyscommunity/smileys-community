import { firstNameOf } from '../data'
// soldOut is last and optional so the existing four-argument calls still
// compile; it means the same thing the badge already said, just for events the
// counter can't tell you about.
export function getUrgency(spotsLeft: number, totalSpots: number, limitedSpots: boolean, fillPercent: number, soldOut = false) {
  if (soldOut || (limitedSpots && spotsLeft <= 0))
    return { label: 'Sold out', bg: 'bg-amber-100 shadow-sm', text: 'text-amber-700', pulse: false }
  if (limitedSpots && spotsLeft <= 2)
    return { label: `🔥 Only ${spotsLeft} left`, bg: 'bg-red-500', text: 'text-white', pulse: true }
  if (limitedSpots && spotsLeft <= 5)
    return { label: `⚡ ${spotsLeft} spots left`, bg: 'bg-orange-500', text: 'text-white', pulse: true }
  if (fillPercent >= 75)
    return { label: 'Almost full', bg: 'bg-orange-100', text: 'text-orange-700', pulse: false }
  return null
}

export function getBarColor(fillPercent: number) {
  if (fillPercent >= 85) return '#ef4444'
  if (fillPercent >= 65) return '#f97316'
  if (fillPercent >= 40) return '#f59e0b'
  return '#34d399'
}

export function buildSocialLabel(
  previews: { name: string }[] | undefined,
  total: number,
): string {
  if (!previews || previews.length === 0) return `${total} going`
  const first = firstNameOf(previews[0].name)
  if (total === 1) return `${first} is going`
  const second = firstNameOf(previews[1]?.name)
  if (total === 2 && second) return `${first} and ${second} are going`
  const rest = total - (second ? 2 : 1)
  if (second) return `${first}, ${second} and ${rest} other${rest !== 1 ? 's' : ''} are going`
  return `${first} and ${rest} other${rest !== 1 ? 's' : ''} are going`
}
