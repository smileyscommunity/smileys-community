import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { getMemberCityIds } from '@/lib/cityMembership'
import { getCityTz } from '@/lib/city'
import { todayInTz, monthRangeFor } from '@/lib/cityTime'

// Events that actually happen here. Drafts, pending, flagged and unpublished
// events aren't public at all (lib/db PUBLIC_EVENT_STATUSES); of the public
// ones, a cancelled event didn't take place and a postponed one isn't taking
// place on the date it still carries.
const HELD_EVENT_STATUSES = ['published', 'archived']

interface Props {
  name: string
  /** Neighborhood names are only unique within a city, so every count here is
   *  city-scoped — otherwise two cities with a "Merkez" would share stats. */
  cityId: string
  groupLink?: string
  groupLabel?: string
  userId?: string
  isYourNeighborhood: boolean
}

export default async function HeroStats({ name, cityId, groupLink, groupLabel, userId, isYourNeighborhood }: Props) {
  // The city's calendar, not server UTC: a Tbilisi event tonight isn't "past"
  // at 21:00 UTC, and the 1st of the month starts at the city's midnight.
  const today    = todayInTz(await getCityTz(cityId))
  // Bounded on both ends: with only `gte` the 1st, "this month" counted
  // every later month too.
  const month    = monthRangeFor(today)

  const [monthlyCount, pastCount, totalLocals, approvedHost, belongsHere, viewerCounted] = await Promise.all([
    prisma.event.count({ where: { neighborhood: name, cityId, status: { in: HELD_EVENT_STATUSES }, date: { gte: month.start, lt: month.nextStart } } }),
    prisma.event.count({ where: { neighborhood: name, cityId, status: { in: HELD_EVENT_STATUSES }, date: { lt: today } } }),
    // "N local members" — activated members only (lib/memberCount), minus the
    // same opt-outs NeighborhoodSections applies: a member who hid their
    // neighborhood, or an admin-hidden account, isn't counted as a local.
    prisma.user.count({ where: { ...ACTIVATED_MEMBER_WHERE, neighborhood: name, cityId, neighborhoodVisible: true, hiddenFromMembers: false } }),
    userId
      ? prisma.clubMembership.findFirst({
          where: { userId, role: 'host', status: 'approved' },
          select: { id: true },
        })
      : null,
    // "Host an event here" only where the viewer could actually file it: a
    // host of an Istanbul club was offered the button on Ankara's Ulus. The
    // gate is belonging to this city — home or joined (lib/cityMembership,
    // the same rule resolvePostingCityId writes by) — not which city their
    // club is in, because a member who joined Ankara may legitimately host
    // there with an Istanbul club, and a global club runs everywhere.
    userId ? getMemberCityIds(userId).then(ids => ids.includes(cityId)) : false,
    // Is the viewer themselves inside `totalLocals`? They are unless they hid
    // their neighborhood — and the strip said "You're among 1 local member"
    // to the only person there, counting them as their own company.
    userId
      ? prisma.user.count({
          where: { ...ACTIVATED_MEMBER_WHERE, id: userId, neighborhood: name, cityId, neighborhoodVisible: true, hiddenFromMembers: false },
        })
      : 0,
  ])
  const otherLocals = Math.max(0, totalLocals - (viewerCounted > 0 ? 1 : 0))

  return (
    <>
      <div className="mt-5 flex items-center gap-5 text-sm flex-wrap">
        {monthlyCount > 0 && (
          <span className="text-white/60">
            <strong className="text-white">{monthlyCount}</strong> event{monthlyCount !== 1 ? 's' : ''} this month
          </span>
        )}
        <span className="text-white/60">
          <strong className="text-white">{pastCount}</strong> past event{pastCount !== 1 ? 's' : ''}
        </span>
        {totalLocals > 0 && (
          <span className="text-white/60">
            <strong className="text-white">{totalLocals}</strong> local member{totalLocals !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {groupLink && (
          <a href={groupLink} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm border border-white/25 text-white text-xs font-semibold rounded-xl hover:bg-white/25 transition-colors">
            💬 {groupLabel ?? 'Join group'}
          </a>
        )}
        {approvedHost && belongsHere && (
          <Link href={`/host/events/new?neighborhood=${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-amber-600 text-xs font-bold rounded-xl hover:bg-amber-50 transition-colors shadow-sm">
            + Host an event here
          </Link>
        )}
      </div>

      {isYourNeighborhood && (
        <div className="mt-6 inline-flex items-center gap-2.5 bg-white/15 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-sm">
          <span className="text-base">🏡</span>
          <span className="text-white font-medium">
            {otherLocals > 0
              ? `You're among ${otherLocals} other local Smileys member${otherLocals !== 1 ? 's' : ''} here`
              : "You're the first local Smileys member here"}
          </span>
        </div>
      )}
    </>
  )
}
