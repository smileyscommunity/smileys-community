import { prisma } from '@/lib/prisma'
import { canActInCity } from '@/lib/access'
import type { SessionUser } from '@/lib/session'

// A recurring series is linked by a shared Event.seriesId, generated client-side
// (crypto.randomUUID) when a host or admin makes copies. The id was an ordinary
// editable field and "apply to series" rewrote every future event carrying it,
// so a host could attach their own event to another host's series id (readable
// from any event payload) and then rewrite or cancel that host's whole series,
// in any city. Two rules close it:
//   - a series id can only be taken when every OTHER event already carrying it
//     is one the caller could edit anyway (checkSeriesId);
//   - "apply to series" only ever touches events the caller could edit
//     (seriesScopeFor), so an old mixed series can't be used either.
export const SERIES_ID_MAX = 64

export async function checkSeriesId(
  seriesId: unknown,
  viewer: SessionUser,
  exceptEventId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (seriesId == null || seriesId === '') return { ok: true }
  if (typeof seriesId !== 'string' || seriesId.length > SERIES_ID_MAX) return { ok: false, error: 'Invalid series id' }
  if (viewer.role === 'admin') return { ok: true }
  const others = await prisma.event.findMany({
    where:  { seriesId, ...(exceptEventId ? { id: { not: exceptEventId } } : {}) },
    select: { hostId: true, cityId: true },
  })
  const moderator = viewer.role === 'moderator'
  const allTheirs = others.every(e => moderator ? canActInCity(viewer, e.cityId) : e.hostId === viewer.id)
  return allTheirs ? { ok: true } : { ok: false, error: 'That series belongs to someone else' }
}

/** The events "apply to series" may touch: every one for an admin, the event's city for a moderator, a host's own otherwise. */
export function seriesScopeFor(viewer: SessionUser, eventCityId: string): { cityId?: string; hostId?: string } {
  if (viewer.role === 'admin') return {}
  if (viewer.role === 'moderator') return { cityId: eventCityId }
  return { hostId: viewer.id }
}
