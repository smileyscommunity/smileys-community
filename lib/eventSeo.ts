// Search-facing text for a public event page. Pure, so the rules are testable.
//
// Titles and descriptions used to carry the host's emoji and open with a
// calendar glyph, so a result read "📅 Friday, November 20 · 18:30 · Kadıköy —
// 🕰️👹 Welcome to…": the reason to click (free? where? when?) came after the
// noise, and the snippet was cut before the plain-language part.

/** Remove pictographs and their joiners; collapse the gaps they leave. */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Free" or the formatted price — the line a searcher decides on. */
export function priceLabel(price: number | null | undefined, format: (p: number) => string): string {
  return !price ? 'Free' : format(price)
}

/** Few enough left that the offer should say so (matches the "Only N left" badge idea). */
export const FEW_LEFT = 5

export function offerAvailability(e: { soldOut?: boolean | null; limitedSpots?: boolean | null; spotsLeft?: number | null }): string {
  if (e.soldOut || (e.limitedSpots && (e.spotsLeft ?? 0) <= 0)) return 'https://schema.org/SoldOut'
  if (e.limitedSpots && (e.spotsLeft ?? 0) <= FEW_LEFT) return 'https://schema.org/LimitedAvailability'
  return 'https://schema.org/InStock'
}

export function eventSeoTitle(p: { title: string; shareDate: string; neighborhood?: string | null; price: string }): string {
  const t = stripEmoji(p.title) || p.title
  return `${t} · ${p.shareDate}${p.neighborhood ? `, ${p.neighborhood}` : ''} · ${p.price} — Smileys Community`
}

export function eventSeoDescription(p: { when: string; price: string; neighborhood?: string | null; body: string }): string {
  const lead = `${p.price} event${p.neighborhood ? ` in ${p.neighborhood}` : ''}, ${p.when}.`
  const body = stripEmoji(p.body)
  return (body ? `${lead} ${body}` : lead).slice(0, 155)
}
