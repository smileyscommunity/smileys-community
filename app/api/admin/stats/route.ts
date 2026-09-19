import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewAnalytics } from '@/lib/access'
import { todayInTz, DEFAULT_TZ, fromWallClockInTz } from '@/lib/cityTime'
import { getCityTz } from '@/lib/city'
import { listStaleSweepers } from '@/lib/cronHealth'
import { stalledLiveCities, stalledSeverity, describeStalled } from '@/lib/cityOps'
import { loadPostponedEvents, planPostponed } from '@/lib/postponedEvents'
import { countRoomsNeedingReview } from '@/lib/attendanceReview'
import { COMMUNITY_MEMBER_WHERE, NOT_ACTIVATED_MEMBER_WHERE, MEMBER_ROLE_FILTER } from '@/lib/memberCount'
import { reportQueueWhere } from '@/lib/admin/reportScope'

// The funnel follows one cohort: applications made in this many days. Recent
// enough to describe the community as it is now, long enough that most
// approved applicants have had an event to go to.
const FUNNEL_DAYS = 90

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || !canViewAnalytics(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ?city=<id> scopes every count below to one city. Omitted means
  // network-wide, which is what the dashboard has always shown — with two
  // cities live that total silently blends them, so the switcher exists to
  // let you ask the question that actually matters: is *this* city working?
  //
  // Admin-only route (canViewAnalytics), so any admin may look at any city;
  // there is no per-city gate to apply here.
  const cityParam = new URL(req.url).searchParams.get('city')
  const city = cityParam
    ? await prisma.city.findUnique({ where: { id: cityParam }, select: { id: true, name: true, slug: true } })
    : null
  if (cityParam && !city) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
  const cityId = city?.id ?? null

  // Most of the models below have no cityId of their own and reach one
  // through a relation. Spelling each path out once keeps the queries honest
  // — and keeps the empty-object fallback (network-wide) in exactly one place.
  const inCity       = cityId ? { cityId }                : {}
  const byUser       = cityId ? { user:     { cityId } }   : {}
  const viaEvent     = cityId ? { event:    { cityId } }   : {}
  const viaHangout   = cityId ? { hangout:  { cityId } }   : {}
  const appCity      = cityId ? { targetCityId: cityId }   : {}

  // Event.date is a bare 'YYYY-MM-DD' meaning a calendar day in the city's
  // own timezone, so "today" has to be asked in that timezone. Both live
  // cities are Europe/Istanbul today; this stops being a no-op the first
  // time a city launches outside it.
  const tz       = cityId ? await getCityTz(cityId) : DEFAULT_TZ
  const todayStr = todayInTz(tz)
  const now      = Date.now()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const monthAgo   = new Date(now - thirtyDays)
  const prevMonth  = new Date(now - (thirtyDays * 2))
  const weekAgo    = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const funnelFrom = new Date(now - FUNNEL_DAYS * 24 * 60 * 60 * 1000)
  // Midnight on the city's clock, not the server's (UTC): the "today"
  // bucket otherwise started at 03:00 Istanbul.
  const todayStart = fromWallClockInTz(`${todayStr}T00:00`, tz)
  // 7 daily buckets ending today (oldest first) — drives the RSVP sparkline
  // on the dashboard. Each entry is [start, end) of one calendar day so
  // we can count joinedAt within without overlap.
  const sevenDayBuckets: { start: Date; end: Date }[] = []
  for (let i = 6; i >= 0; i--) {
    const start = new Date(todayStart.getTime() - i * 86_400_000)
    const end   = new Date(start.getTime() + 86_400_000)
    sevenDayBuckets.push({ start, end })
  }

  // The Reports pill counts what the moderation queue lists: the same filter
  // (lib/admin/reportScope) — content reports under the content's city, and
  // never reports about the viewer. It used to scope by the reported member's
  // city alone.
  const reportsWhere = await reportQueueWhere(session, { cityId })

  // The funnel cohort: applications to this city in the window, and which
  // of them were approved. The later steps are counted from these people
  // only, so each step is a subset of the one before it. It used to divide
  // every approved account (admins, invited and imported members included)
  // by every application ever, and count future RSVPs as a "first event" —
  // with event city and member city mixed, it could pass 100%.
  const cohort = await prisma.memberApplication.findMany({
    where:  { createdAt: { gte: funnelFrom }, ...appCity },
    select: { email: true, status: true },
  }) as { email: string; status: string }[]
  const approvedEmails = [...new Set(cohort.filter(a => a.status === 'approved').map(a => a.email))]

  const [
    totalAccounts, members, membersActivated, membersNotActivated, hosts, events, rsvps,
    pendingApplications, pendingReports, upcoming,
    newMembersThisMonth, prevMembersMonth,
    rsvpsThisMonth, prevRsvpsMonth,
    paidNow, paidPrev, paidPending,
    hangoutsActive, hangoutsToday, hangoutReferencesWeek,
    topHostGroup, visitorsThisWeek,
    attendedGroups,
    survey30d, surveyPrev30d,
    pendingJoinRequests, todayEventsRaw,
    ...rsvpsByDayCounts
  ] = await Promise.all<any>([
    prisma.user.count({ where: { role: { not: 'admin' }, ...inCity } }),
    // Members = every role but admin and partner (MEMBER_ROLE_FILTER) — the
    // city cards' and dashboard's rule. member+moderator here dropped hosts.
    prisma.user.count({ where: { status: 'approved', role: MEMBER_ROLE_FILTER, ...inCity } }),
    // The same members split by activation (lib/memberCount): activated is what
    // every public figure shows; the rest approved and never set a password.
    prisma.user.count({ where: { ...COMMUNITY_MEMBER_WHERE, ...inCity } }),
    prisma.user.count({ where: { ...NOT_ACTIVATED_MEMBER_WHERE, role: MEMBER_ROLE_FILTER, ...inCity } }),
    // Scoped by the host's own city rather than the club's: a global club
    // (cityId null) has no city to attribute its hosts to, and this metric
    // sits next to `members` — both should mean "people in this city".
    prisma.clubMembership.groupBy({ by: ['userId'], where: { role: 'host', status: 'approved', ...byUser } }).then(r => r.length),
    prisma.event.count({ where: { ...inCity } }),
    prisma.eventAttendee.count({ where: { status: 'approved', user: { role: { not: 'admin' } }, ...viaEvent } }),
    prisma.memberApplication.count({ where: { status: 'pending', ...appCity } }),
    prisma.report.count({ where: { ...reportsWhere, status: 'pending' } }),
    // Upcoming means on the calendar: published, from today on. Drafts,
    // pending, postponed and cancelled events used to count too.
    prisma.event.count({ where: { status: 'published', date: { gte: todayStr }, ...inCity } }),
    // Members growth
    prisma.user.count({ where: { status: 'approved', role: { not: 'admin' }, joinedAt: { gte: monthAgo }, ...inCity } }),
    prisma.user.count({ where: { status: 'approved', role: { not: 'admin' }, joinedAt: { gte: prevMonth, lt: monthAgo }, ...inCity } }),
    // RSVPs growth
    prisma.eventAttendee.count({ where: { status: 'approved', joinedAt: { gte: monthAgo }, ...viaEvent } }),
    prisma.eventAttendee.count({ where: { status: 'approved', joinedAt: { gte: prevMonth, lt: monthAgo }, ...viaEvent } }),
    // Revenue, per currency — lira and euro don't add up to anything. Paid
    // is compared like for like: the last 30 days against the 30 before. The
    // trend used to set all-time revenue against one previous month, so it
    // read hugely positive forever. Pending is everything still owed,
    // whenever it was created.
    prisma.payment.groupBy({ by: ['currency'], where: { status: 'paid', createdAt: { gte: monthAgo }, ...viaEvent }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['currency'], where: { status: 'paid', createdAt: { gte: prevMonth, lt: monthAgo }, ...viaEvent }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['currency'], where: { status: 'pending', ...viaEvent }, _sum: { amount: true }, _count: { _all: true } }),
    // Hangouts pulse — active (in-flight) hangouts, today's posts, and
    // references created in the last 7 days. References-this-week is the
    // best proxy for "is the trust loop actually firing?"
    prisma.hangout.count({ where: { status: 'active', endsAt: { gte: new Date() }, ...inCity } }),
    prisma.hangout.count({ where: { startsAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) }, ...inCity } }),
    prisma.hangoutReference.count({ where: { createdAt: { gte: weekAgo }, ...viaHangout } }),
    // Top hangout host this week — surfaces the rising community
    // connector. groupBy + take=1 keeps it to a single query.
    prisma.hangout.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: weekAgo }, ...inCity },
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 1,
    }),
    // Visitors arriving this week — soft alert pill on the dashboard.
    // Counts active announcements that start in the next 7 days.
    prisma.visitorAnnouncement.count({
      where: {
        status:   'active',
        startsOn: { gte: todayStr, lte: todayInTz(tz, 7) },
        ...inCity,
      },
    }),
    // Conversion funnel, last two steps: of the cohort's approved members,
    // who has actually been to an event — one that has happened, in this
    // city, where they were checked in or marked attended — and who has been
    // to two. An RSVP to next week isn't a first event yet.
    approvedEmails.length === 0 ? Promise.resolve([]) : prisma.eventAttendee.groupBy({
      by:     ['userId'],
      where:  {
        status: 'approved',
        OR:     [{ checkedIn: true }, { attendance: 'attended' }],
        user:   { email: { in: approvedEmails } },
        event:  { date: { lt: todayStr }, status: { in: ['published', 'archived'] }, ...inCity },
      },
      _count: { _all: true },
    }),
    // Post-event survey rollup — 30d window + previous-30d window
    // for a trend arrow. Three counts each (total, would-return-true,
    // anomaly-true) because Prisma's typed API doesn't expose _sum
    // on Boolean columns. Counted in the same Promise.all so wall
    // time stays flat.
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, ...viaEvent } })
      .then(async total => ({
        total,
        ret:  await prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, wouldReturn: true, ...viaEvent } }),
        anom: await prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, anomaly: true, ...viaEvent } }),
      })),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevMonth, lt: monthAgo }, ...viaEvent } })
      .then(async total => ({
        total,
        ret:  await prisma.eventSurvey.count({ where: { createdAt: { gte: prevMonth, lt: monthAgo }, wouldReturn: true, ...viaEvent } }),
        anom: await prisma.eventSurvey.count({ where: { createdAt: { gte: prevMonth, lt: monthAgo }, anomaly: true, ...viaEvent } }),
      })),
    // Join requests waiting for a decision on upcoming events — the
    // /admin/participants inbox's Pending count, surfaced as an alert
    // pill so requests don't sit unseen until someone opens that page.
    prisma.eventAttendee.count({
      where: { status: 'pending', event: { date: { gte: todayStr }, status: 'published', ...inCity } },
    }),
    // Events running TODAY with going/checked-in counts — drives the
    // "happening today" hero. On event days the dashboard's top job is
    // door ops, not lifetime stats.
    prisma.event.findMany({
      where:   { date: todayStr, status: 'published', ...inCity },
      orderBy: { time: 'asc' },
      select: {
        id: true, title: true, emoji: true, time: true, totalSpots: true,
        attendees: { where: { status: 'approved' }, select: { checkedIn: true } },
      },
    }),
    // RSVPs by day — 7 separate counts. Each runs against an indexed
    // (status, joinedAt) range so they're individually cheap; the
    // Promise.all parallelism keeps total wall-time low.
    ...sevenDayBuckets.map(b =>
      prisma.eventAttendee.count({
        where: { status: 'approved', joinedAt: { gte: b.start, lt: b.end }, ...viaEvent },
      }),
    ),
  ])

  // groupBy return types got widened to any by the Promise.all<any> cast
  // needed to mix in the dynamic ...sevenDayBuckets spread; re-narrow here.
  type PayBucket = { currency: string; _sum: { amount: number | null }; _count?: { _all: number } }
  const nowArr     = paidNow     as PayBucket[]
  const prevArr    = paidPrev    as PayBucket[]
  const pendingArr = paidPending as PayBucket[]
  const pendingPayments = pendingArr.reduce((n, p) => n + (p._count?._all ?? 0), 0)

  // Trends (percentage growth)
  const calcTrend = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100)
  }

  // One row per currency that has any paid or pending money, largest 30-day
  // take first. Amounts are never summed across currencies.
  const sumFor = (arr: PayBucket[], c: string) => arr.find(p => p.currency === c)?._sum.amount ?? 0
  const revenue = [...new Set([...nowArr, ...prevArr, ...pendingArr].map(p => p.currency))]
    .map(currency => {
      const collected = sumFor(nowArr, currency)
      const previous  = sumFor(prevArr, currency)
      return { currency, collected, previous, trend: calcTrend(collected, previous), pending: sumFor(pendingArr, currency) }
    })
    .sort((a, b) => b.collected - a.collected || b.pending - a.pending)

  // Hydrate top hangout host's display fields (name + color) — separate
  // query because Prisma's groupBy can't include relations.
  const topHostId = topHostGroup?.[0]?.userId as string | undefined
  const topHostUser = topHostId
    ? await prisma.user.findUnique({ where: { id: topHostId }, select: { id: true, name: true, color: true, profilePhoto: true } })
    : null

  // Conversion funnel — distinct attendees from the groupBy above.
  const groups       = (attendedGroups ?? []) as { userId: string; _count: { _all: number } }[]
  const firstEvent   = groups.length
  const repeatEvent  = groups.filter(g => g._count._all >= 2).length

  // #4: email-failure count in the last 24h, surfaced on the
  // dashboard alerts row. Anything > 0 means SMTP/Resend is
  // probably broken and members are missing transactional emails.
  // Cheap query — indexed on createdAt.
  //
  // #5: sweeper health. listStaleSweepers walks the registered
  // sweeper names and returns any whose lastSuccessAt is older
  // than 2× their expected cadence (or never recorded). Tiny
  // table, so the read is cheap.
  //
  // Liquidity signal (multi-city item 7): a live city with no upcoming
  // event is a city where a new member can join and find nothing to do —
  // the one failure mode the status flag cannot see. Scoped to ?city= when
  // the dashboard is; otherwise every live city.
  //
  // Postponed events with no new date sit outside every sweep, seats and all
  // (lib/postponedEvents). A failed lookup costs the pill, not the dashboard.
  const [emailFailures24h, staleSweepers, stalled, postponed, roomsNeedingReview] = await Promise.all([
    prisma.emailFailure.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    listStaleSweepers(),
    stalledLiveCities(new Date(), cityId ? [cityId] : undefined),
    loadPostponedEvents({ cityId })
      .then(facts => planPostponed(facts, new Date()).filter(r => r.needsNewDate))
      .catch(err => { console.error('[admin stats] postponed events lookup failed', err); return [] }),
    // Rooms in their review day with someone still unmarked. After tonight
    // those seats settle and the cheap fix — a check-in, a waiver — is gone,
    // so this is the one attendance number worth a dashboard pill. Costs the
    // pill, not the dashboard, if it fails.
    countRoomsNeedingReview(new Date(), undefined, cityId ?? undefined)
      .catch(err => { console.error('[admin stats] review queue count failed', err); return 0 }),
  ])

  return NextResponse.json({
    // Which city these numbers describe — null means network-wide. The UI
    // labels every card from this, so a scoped total can never be mistaken
    // for the platform total.
    city,
    totalAccounts, members, membersActivated, membersNotActivated, hosts, events, upcoming, rsvps,
    newMembersThisMonth, revenue, pendingPayments,
    pendingApplications, pendingReports, emailFailures24h, roomsNeedingReview,
    pendingJoinRequests: pendingJoinRequests as number,
    // Today's events with live door-ops counts, sorted by start time.
    todayEvents: (todayEventsRaw as { id: string; title: string; emoji: string; time: string; totalSpots: number; attendees: { checkedIn: boolean }[] }[])
      .map(e => ({
        id: e.id, title: e.title, emoji: e.emoji, time: e.time, totalSpots: e.totalSpots,
        going:     e.attendees.length,
        checkedIn: e.attendees.filter(a => a.checkedIn).length,
      })),
    staleSweepers: staleSweepers.map(s => s.name),
    // Live cities with nothing on the calendar, oldest-live first. `label`
    // is the one-line description the pill shows; `severity` turns red past
    // STALLED_RED_AFTER_DAYS so a fresh launch reads as a nudge, not a fire.
    stalledCities: stalled.map(c => ({
      id: c.id, slug: c.slug, name: c.name, members: c.members, daysLive: c.daysLive,
      severity: stalledSeverity(c.daysLive), label: describeStalled(c),
    })),
    // Longest-postponed first. daysSincePostponed comes from the audit trail;
    // fromAudit false means it fell back to updatedAt (a lower bound).
    postponedNoDate: postponed.map(r => ({
      id: r.id, title: r.title, emoji: r.emoji, date: r.date, seats: r.seats, pending: r.pending,
      waitlist: r.waitlist, paymentsPending: r.paymentsPending, daysSincePostponed: r.daysSincePostponed, fromAudit: r.fromAudit,
    })),
    trends: {
      members: calcTrend(newMembersThisMonth, prevMembersMonth),
      rsvps:   calcTrend(rsvpsThisMonth, prevRsvpsMonth),
    },
    hangouts: {
      active:         hangoutsActive,
      today:          hangoutsToday,
      referencesWeek: hangoutReferencesWeek,
      // Top host this week — null when nobody posted any hangouts in the
      // window. Render conditionally on the client.
      topHost: topHostUser ? {
        ...topHostUser,
        count: topHostGroup[0]._count._all as number,
      } : null,
    },
    visitorsThisWeek,
    funnel: {
      windowDays:   FUNNEL_DAYS,
      applications: cohort.length,
      approved:     approvedEmails.length,
      firstEvent,
      repeat:       repeatEvent,
    },
    // Post-event survey quality signal (last 30d + previous 30d for
    // a trend arrow). Null wouldReturnRate when no responses in the
    // window — UI renders "—" instead of a misleading 0%.
    quality: (() => {
      const cur  = survey30d     as { total: number; ret: number; anom: number }
      const prev = surveyPrev30d as { total: number; ret: number; anom: number }
      const rate     = cur.total  > 0 ? Math.round((cur.ret  / cur.total)  * 100) : null
      const prevRate = prev.total > 0 ? Math.round((prev.ret / prev.total) * 100) : null
      return {
        responses:       cur.total,
        anomalies:       cur.anom,
        wouldReturnRate: rate,
        anomalyRate:     cur.total > 0 ? Math.round((cur.anom / cur.total) * 100) : null,
        // Trend in percentage-points, not a percentage — "+3pp" reads
        // correctly for rates whereas calcTrend's relative %-change
        // would say "5%" for a 80→84pp shift, which is misleading.
        rateTrendPp:     (rate !== null && prevRate !== null) ? rate - prevRate : null,
        responsesTrend:  calcTrend(cur.total, prev.total),
      }
    })(),
    // Oldest → newest, 7 days. Drives the dashboard RSVP sparkline.
    rsvpsByDay: rsvpsByDayCounts as number[],
    // Deploy metadata — release is baked at build time (deploy.sh sets
    // APP_RELEASE=$(git rev-parse --short HEAD)); uptimeSeconds gives
    // time since pm2 restart ≈ time since deploy.
    release:        process.env.APP_RELEASE ?? null,
    uptimeSeconds:  Math.round(process.uptime()),
  })
}
