import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { claimOnce } from '@/lib/rateLimit'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { firstNameOf } from '@/lib/data'
import { notifyText } from '@/lib/visitorPolicy'

// "Visitor coming to Moda" — the push to a neighbourhood's locals when a
// visit names one. Once per (visit, neighbourhood): a new post pings, an
// edit that moves the visit to another neighbourhood pings that one, an
// edit that only changes the dates pings nobody twice. Server-side only.

export async function notifyLocalsOfVisit(v: {
  id: string; userId: string; cityId: string; citySlug: string; neighborhood: string | null
  name: string; fromCity: string | null; startsOn: string; endsOn: string
}): Promise<number> {
  if (!v.neighborhood) return 0
  if (!await claimOnce(`visitor-ping:${v.id}:${v.neighborhood}`, 30 * 24 * 60 * 60_000)) return 0
  // A blocked pair sees nothing of each other — hangouts, availability
  // pulses, listings and mentions all drop them. Both directions.
  const blocked = new Set((await prisma.memberBlock.findMany({
    where:  { OR: [{ blockerId: v.userId }, { blockedId: v.userId }] },
    select: { blockerId: true, blockedId: true },
  })).map(b => (b.blockerId === v.userId ? b.blockedId : b.blockerId)))
  const locals = await prisma.user.findMany({
    // Destination city's locals — neighbourhood names are only unique per
    // city, and an Istanbul 'Moda' ping about an Izmir visit would be noise.
    where:  { neighborhood: v.neighborhood, status: 'approved', hiddenFromMembers: false, cityId: v.cityId },
    select: { id: true },
  })
  // The push reads the member's own words: a first name and a place, one
  // line, no links.
  const from = notifyText(v.fromCity)
  const day  = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const link = v.citySlug === DEFAULT_CITY_SLUG ? '/visiting' : `/visiting?city=${v.citySlug}`
  let sent = 0
  for (const u of locals) {
    if (u.id === v.userId || blocked.has(u.id)) continue
    const ok = await createNotification(u.id, 'visitor_announced', `👋 Visitor coming to ${v.neighborhood}`,
      `${firstNameOf(v.name)}${from ? ` from ${from}` : ''} — ${day(v.startsOn)} – ${day(v.endsOn)}`, link).catch(() => false)
    if (ok) sent++
  }
  return sent
}
