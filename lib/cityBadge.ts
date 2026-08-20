/**
 * The hero eyebrow for a city-scoped feed: the editor's badge, plus the city.
 *
 * Appending the city naively produced "ISTANBUL · ISTANBUL" on the events page,
 * because the client-state default badge IS a city name and production's CMS
 * value is empty. Both cases collapse to the city on its own:
 *
 *   ('Events', 'Bodrum')   -> 'Events · Bodrum'
 *   ('', 'Bodrum')         -> 'Bodrum'
 *   ('Istanbul','Istanbul')-> 'Istanbul'
 *   ('Events', '')         -> 'Events'      (city not resolved yet)
 *
 * Shared rather than inlined because three feeds render this eyebrow and the
 * duplication bug only showed up on one of them.
 */
export function cityBadge(badge: string | null | undefined, cityName: string | null | undefined): string {
  const b = badge?.trim() ?? ''
  const c = cityName?.trim() ?? ''
  if (!c) return b
  if (!b || b.toLowerCase() === c.toLowerCase()) return c
  return `${b} · ${c}`
}
