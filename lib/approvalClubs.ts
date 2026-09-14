import { prisma } from '@/lib/prisma'

export type ClubCityRow = { id: string; cityId: string | null }

export type SkippedClub = {
  clubId: string
  // other_city: a city-scoped club outside the city the member is approved
  // into. not_found: no such club (a stale id would only fail the enrolment).
  reason:      'other_city' | 'not_found'
  clubCityId?: string
}

/**
 * Which of the requested clubs a member approved into `cityId` may be put in:
 * that city's own clubs, or global clubs (cityId null). Order is kept and
 * duplicates collapse. Pure, so the rule is testable without a database.
 */
export function partitionClubsForCity(
  clubIds: readonly unknown[],
  clubs: readonly ClubCityRow[],
  cityId: string,
): { keep: string[]; skipped: SkippedClub[] } {
  const byId = new Map(clubs.map(c => [c.id, c]))
  const keep: string[] = []
  const skipped: SkippedClub[] = []
  const seen = new Set<string>()
  for (const raw of clubIds) {
    if (typeof raw !== 'string' || seen.has(raw)) continue
    seen.add(raw)
    const club = byId.get(raw)
    if (!club) skipped.push({ clubId: raw, reason: 'not_found' })
    else if (club.cityId && club.cityId !== cityId) skipped.push({ clubId: raw, reason: 'other_city', clubCityId: club.cityId })
    else keep.push(raw)
  }
  return { keep, skipped }
}

/** partitionClubsForCity over the clubs' stored cities. */
export async function clubsForApprovedCity(clubIds: readonly unknown[], cityId: string) {
  const ids = [...new Set(clubIds.filter((c): c is string => typeof c === 'string'))]
  if (!ids.length) return { keep: [], skipped: [] as SkippedClub[] }
  const clubs = await prisma.club.findMany({ where: { id: { in: ids } }, select: { id: true, cityId: true } })
  return partitionClubsForCity(ids, clubs, cityId)
}
