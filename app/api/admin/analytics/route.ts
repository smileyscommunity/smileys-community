import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewAnalytics } from '@/lib/access'
import { getCached, setCached } from '@/lib/analyticsCache'
import { todayIstanbul } from '@/lib/data'

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const PERIODS: Record<string, { months: number; label: string }> = {
  '30d':  { months: 1,  label: 'Last 30 days'     },
  '90d':  { months: 3,  label: 'Last 90 days'      },
  '6m':   { months: 6,  label: 'Last 6 months'     },
  '12m':  { months: 12, label: 'Last 12 months'    },
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canViewAnalytics(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const periodKey = (req.nextUrl.searchParams.get('period') ?? '6m') as keyof typeof PERIODS
    const period    = PERIODS[periodKey] ?? PERIODS['6m']
    const numMonths = period.months

    const cacheKey = `analytics:${periodKey}`
    const cached   = getCached<object>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const now   = new Date()
    const today = todayIstanbul()
    const day30 = new Date(now.getTime() - 30 * 86400000)
    const day60 = new Date(now.getTime() - 60 * 86400000)
    const day90 = new Date(now.getTime() - 90 * 86400000)
    const periodStart = new Date(now.getFullYear(), now.getMonth() - (numMonths - 1), 1)

    // Month labels for selected period
    const monthKeys: string[] = []
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthKeys.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))
    }
    const emptyMonths = () => Object.fromEntries(monthKeys.map(k => [k, 0]))

    // Promise.all tuple exceeds TypeScript's inference limit (~10 elements),
    // so the destructured variables lose their Prisma types and become any[].
    // Explicit cast here restores safety at the usage sites below.
    const [
      allUsers, allApps, allEvents, allAttendees, allPayments, allReports,
      topEventsRaw, topClubs,
      activeAttendees, dormantMembers, repeatRsvpData,
      memberNeighborhoods, eventNeighborhoods, attendedEventTags,
      revenueByClubRaw, refundsByHostRaw,
      hangoutsInPeriod, referencesInPeriod,
      hostApplications, eventsByHost, approvedApps,
      reportsInPeriod, bansInPeriod, totalApprovedMembers,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { role: { not: 'admin' } },
        select: { status: true, joinedAt: true },
      }),
      prisma.memberApplication.findMany({
        select: { status: true, interests: true, createdAt: true },
      }),
      prisma.event.findMany({
        select: { date: true, status: true, totalSpots: true, spotsLeft: true, price: true, createdAt: true },
      }),
      prisma.eventAttendee.findMany({
        where: { status: 'approved' },
        // userId needed for cohort retention math (which cohort attended an
        // event within their first 30 / 90 days).
        select: { joinedAt: true, userId: true },
      }),
      prisma.payment.findMany({
        select: { status: true, amount: true, createdAt: true },
      }),
      prisma.report.groupBy({ by: ['status'], _count: true }),
      prisma.event.findMany({
        where: { date: { lt: today } },
        orderBy: { attendees: { _count: 'desc' } },
        take: 5,
        select: {
          id: true, title: true, date: true, totalSpots: true,
          _count: { select: { attendees: { where: { status: 'approved' } } } },
        },
      }),
      prisma.club.findMany({
        where: { isActive: true },
        select: { id: true, name: true, emoji: true, memberCount: true, _count: { select: { events: true } } },
        orderBy: { memberCount: 'desc' },
        take: 5,
      }),
      // Active members: attended at least 1 event in last 30 days
      prisma.eventAttendee.findMany({
        where: { status: 'approved', joinedAt: { gte: day30 } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Dormant members: approved but no event attendance in 90+ days
      prisma.user.findMany({
        where: {
          status: 'approved',
          role: { in: ['member', 'moderator'] },
          joinedEvents: {
            none: { joinedAt: { gte: day90 }, status: 'approved' },
          },
        },
        select: { id: true, name: true, joinedAt: true, interests: true, neighborhood: true },
        orderBy: { joinedAt: 'asc' },
        take: 20,
      }),
      // Repeat RSVP rate: users with more than 1 RSVP vs total unique attendees
      prisma.eventAttendee.groupBy({
        by: ['userId'],
        where: { status: 'approved' },
        _count: { userId: true },
      }),
      // Member neighborhoods
      prisma.user.findMany({
        where: { status: 'approved', neighborhood: { not: '' } },
        select: { neighborhood: true },
      }),
      // Event neighborhoods (all published/archived)
      prisma.event.findMany({
        where: { status: { in: ['published', 'archived'] }, neighborhood: { not: '' } },
        select: { neighborhood: true },
      }),
      // Interests from actually attended events (via tags)
      prisma.eventAttendee.findMany({
        where: { status: 'approved' },
        select: {
          event: { select: { tags: { select: { tag: { select: { name: true } } } } } },
        },
      }),
      // Revenue per club: paid payments → event → club
      prisma.payment.findMany({
        where: { status: 'paid' },
        select: {
          amount: true,
          event: { select: { clubId: true, club: { select: { name: true, emoji: true } } } },
        },
      }),
      // Refund rate by host: all payments with event host info
      prisma.payment.findMany({
        where: { status: { in: ['paid', 'refunded'] } },
        select: {
          status: true,
          amount: true,
          event: {
            select: {
              hostId: true,
              title:  true,
              club:   { select: { name: true } },
            },
          },
        },
      }),
      // Hangouts created in the selected period — feeds byMonth chart and
      // top-hosts ranking. Includes host name for the leaderboard row.
      prisma.hangout.findMany({
        where:  { createdAt: { gte: periodStart } },
        select: {
          createdAt: true,
          userId:    true,
          user:      { select: { id: true, name: true, color: true, profilePhoto: true } },
        },
      }),
      // Hangout references in the selected period — drives the velocity
      // chart + vibe breakdown ("is the trust loop firing? what shape?").
      prisma.hangoutReference.findMany({
        where:  { createdAt: { gte: periodStart } },
        select: { createdAt: true, vibe: true },
      }),
      // Host pipeline — every application where the applicant said
      // contribution: 'host'. We need fullName + email + interests so the
      // page can render the Yasemin trap: approved-host-candidates with
      // 0 events to their name.
      prisma.memberApplication.findMany({
        where:  { contribution: 'host' },
        select: { fullName: true, email: true, status: true, createdAt: true, interests: true },
      }),
      // Events grouped by hostId so we can tell which host-intent users
      // have actually thrown an event vs. fell through onboarding.
      prisma.event.groupBy({
        by: ['hostId'],
        where:  { status: { in: ['published', 'archived'] } },
        _count: { _all: true },
      }),
      // All approved-status applications with source — the acquisition
      // attribution dataset. Matched to users-with-event-attendance below
      // to compute conversion-by-source.
      prisma.memberApplication.findMany({
        where:  { status: 'approved' },
        select: { email: true, source: true },
      }),
      // Reports in the selected period with their resolution timestamps —
      // drives mod velocity ("how fast are reports getting actioned?") and
      // surfaces repeat offenders (users named in ≥2 reports).
      prisma.report.findMany({
        where:  { createdAt: { gte: periodStart } },
        select: { createdAt: true, status: true, reviewedAt: true, reportedId: true },
      }),
      // Bans applied in period — pulled from the AuditLog so a ban that
      // was later reversed still counts as a moderation action taken.
      prisma.auditLog.findMany({
        where:  { createdAt: { gte: periodStart }, action: 'user.ban' },
        select: { createdAt: true },
      }),
      // Total approved members — denominator for the ban-rate metric.
      prisma.user.count({ where: { status: 'approved', role: { in: ['member', 'moderator'] } } }),
    ]) as [any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], number]

    // ── Members ──────────────────────────────────────────────────────────────
    const approved = allUsers.filter((u: any) => u.status === 'approved')
    const newLast30 = approved.filter((u: any) => new Date(u.joinedAt) >= day30).length
    const newPrev30 = approved.filter((u: any) => new Date(u.joinedAt) >= day60 && new Date(u.joinedAt) < day30).length
    const growthRate = newPrev30 > 0 ? Math.round(((newLast30 - newPrev30) / newPrev30) * 100) : newLast30 > 0 ? 100 : 0

    const memberByMonth = emptyMonths()
    for (const u of approved) {
      const d = new Date(u.joinedAt)
      if (d < periodStart) continue
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in memberByMonth) memberByMonth[key]++
    }

    // ── Applications ─────────────────────────────────────────────────────────
    const appApproved = allApps.filter(a => a.status === 'approved').length
    const appRejected = allApps.filter(a => a.status === 'rejected').length
    const appPending  = allApps.filter(a => a.status === 'pending').length
    const approvalRate = (appApproved + appRejected) > 0
      ? Math.round((appApproved / (appApproved + appRejected)) * 100) : null

    const appByMonth = emptyMonths()
    for (const a of allApps) {
      const d = new Date(a.createdAt)
      if (d < periodStart) continue
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in appByMonth) appByMonth[key]++
    }

    const interestCount: Record<string, number> = {}
    for (const a of allApps) {
      for (const i of (a.interests ?? [])) interestCount[i] = (interestCount[i] ?? 0) + 1
    }
    const topInterests = Object.entries(interestCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([interest, count]) => ({ interest, count }))

    // ── Events ───────────────────────────────────────────────────────────────
    const publishedEvents = allEvents.filter(e => e.status === 'published')
    const pastEvents      = publishedEvents.filter(e => e.date < today)
    const upcomingEvents  = publishedEvents.filter(e => e.date >= today)

    const avgFill = pastEvents.length > 0
      ? Math.round(pastEvents.reduce((sum, e) => {
          const going = e.totalSpots - e.spotsLeft
          return sum + (e.totalSpots > 0 ? (going / e.totalSpots) * 100 : 0)
        }, 0) / pastEvents.length)
      : 0

    const eventByMonth = emptyMonths()
    for (const e of allEvents) {
      const d = new Date(e.createdAt)
      if (d < periodStart) continue
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in eventByMonth) eventByMonth[key]++
    }

    const rsvpByMonth = emptyMonths()
    for (const a of allAttendees) {
      const d = new Date(a.joinedAt)
      if (d < periodStart) continue
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in rsvpByMonth) rsvpByMonth[key]++
    }

    // ── Revenue ───────────────────────────────────────────────────────────────
    const paid     = allPayments.filter(p => p.status === 'paid')
    const pending  = allPayments.filter(p => p.status === 'pending')
    const refunded = allPayments.filter(p => p.status === 'refunded')
    const revenueCollected = paid.reduce((s, p) => s + p.amount, 0)
    const revenuePending   = pending.reduce((s, p) => s + p.amount, 0)
    const revenueRefunded  = refunded.reduce((s, p) => s + p.amount, 0)

    const revenueByMonth = emptyMonths()
    for (const p of paid) {
      const d = new Date(p.createdAt)
      if (d < periodStart) continue
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in revenueByMonth) revenueByMonth[key] += p.amount
    }

    // ── Reports ───────────────────────────────────────────────────────────────
    const reportPending   = allReports.find(r => r.status === 'pending')?._count   ?? 0
    const reportActioned  = allReports.find(r => r.status === 'actioned')?._count  ?? 0
    const reportDismissed = allReports.find(r => r.status === 'dismissed')?._count ?? 0

    // ── Revenue per club ─────────────────────────────────────────────────────
    const clubRevMap: Record<string, { name: string; emoji: string; revenue: number; payments: number }> = {}
    for (const p of revenueByClubRaw) {
      const clubId = p.event.clubId
      if (!clubId) continue
      if (!clubRevMap[clubId]) clubRevMap[clubId] = { name: p.event.club?.name ?? clubId, emoji: p.event.club?.emoji ?? '⬡', revenue: 0, payments: 0 }
      clubRevMap[clubId].revenue   += p.amount
      clubRevMap[clubId].payments  += 1
    }
    const revenueByClub = Object.entries(clubRevMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)

    // ── Refund rate by host ───────────────────────────────────────────────────
    const hostRefundMap: Record<string, { hostId: string; clubName: string; paid: number; refunded: number; refundedAmount: number; paidAmount: number }> = {}
    for (const p of refundsByHostRaw) {
      const hostId = p.event.hostId
      if (!hostId) continue
      if (!hostRefundMap[hostId]) hostRefundMap[hostId] = { hostId, clubName: p.event.club?.name ?? '—', paid: 0, refunded: 0, refundedAmount: 0, paidAmount: 0 }
      if (p.status === 'paid')     { hostRefundMap[hostId].paid++;     hostRefundMap[hostId].paidAmount     += p.amount }
      if (p.status === 'refunded') { hostRefundMap[hostId].refunded++; hostRefundMap[hostId].refundedAmount += p.amount }
    }

    // Enrich with host names
    const hostIdsForRefunds = Object.keys(hostRefundMap)
    const hostNamesForRefunds = hostIdsForRefunds.length
      ? await prisma.user.findMany({ where: { id: { in: hostIdsForRefunds } }, select: { id: true, name: true } })
      : []
    const hostNameMap = Object.fromEntries(hostNamesForRefunds.map((u: { id: string; name: string }) => [u.id, u.name]))

    const refundRateByHost = Object.values(hostRefundMap)
      .filter(h => h.paid + h.refunded >= 3)
      .map(h => ({
        hostId:        h.hostId,
        hostName:      hostNameMap[h.hostId] ?? 'Unknown',
        clubName:      h.clubName,
        paid:          h.paid,
        refunded:      h.refunded,
        refundedAmount: h.refundedAmount,
        refundRate:    Math.round((h.refunded / (h.paid + h.refunded)) * 100),
      }))
      .sort((a, b) => b.refundRate - a.refundRate)
      .slice(0, 8)

    // ── Geography ────────────────────────────────────────────────────────────
    function normalizeNeighborhood(n: string | null): string {
      if (!n) return ''
      return n.toLowerCase()
        .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's').replace(/Ş/g, 's')
        .replace(/ç/g, 'c').replace(/Ç/g, 'c').replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
        .replace(/ö/g, 'o').replace(/Ö/g, 'o').replace(/ü/g, 'u').replace(/Ü/g, 'u')
        .trim()
    }

    // Canonical name = first occurrence with highest count (Turkish chars preferred)
    const memberNbCount: Record<string, { count: number; canonical: string }> = {}
    for (const { neighborhood } of memberNeighborhoods) {
      const key = normalizeNeighborhood(neighborhood)
      if (!key) continue
      if (!memberNbCount[key]) memberNbCount[key] = { count: 0, canonical: neighborhood! }
      memberNbCount[key].count++
    }

    const eventNbCount: Record<string, number> = {}
    for (const { neighborhood } of eventNeighborhoods) {
      const key = normalizeNeighborhood(neighborhood)
      if (!key) continue
      eventNbCount[key] = (eventNbCount[key] ?? 0) + 1
    }

    const allNbKeys = new Set([...Object.keys(memberNbCount), ...Object.keys(eventNbCount)])
    const neighborhoodData = Array.from(allNbKeys)
      .map(key => ({
        name:    memberNbCount[key]?.canonical ?? key,
        members: memberNbCount[key]?.count ?? 0,
        events:  eventNbCount[key] ?? 0,
      }))
      .filter(n => n.members > 0 || n.events > 0)
      .sort((a, b) => (b.members + b.events) - (a.members + a.events))
      .slice(0, 12)

    // ── Interest Alignment ────────────────────────────────────────────────────
    const attendedTagCount: Record<string, number> = {}
    for (const { event } of attendedEventTags) {
      for (const { tag } of event.tags) {
        attendedTagCount[tag.name] = (attendedTagCount[tag.name] ?? 0) + 1
      }
    }
    const topAttendedInterests = Object.entries(attendedTagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([interest, count]) => ({ interest, count }))

    // ── Engagement ────────────────────────────────────────────────────────────
    const activeMemberCount  = activeAttendees.length
    const activeMemberRate   = approved.length > 0 ? Math.round((activeMemberCount / approved.length) * 100) : 0
    const dormantCount       = dormantMembers.length
    const totalUniqueRsvpers = repeatRsvpData.length
    const repeatRsvpers      = repeatRsvpData.filter(r => r._count.userId > 1).length
    const repeatRsvpRate     = totalUniqueRsvpers > 0 ? Math.round((repeatRsvpers / totalUniqueRsvpers) * 100) : 0

    // ── Hangouts ──────────────────────────────────────────────────────────────
    // byMonth buckets — same labels as members/events charts so they line up
    // visually when admins compare across sections.
    const hangoutsByMonth   = emptyMonths()
    const referencesByMonth = emptyMonths()
    for (const h of hangoutsInPeriod) {
      const key = new Date(h.createdAt).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in hangoutsByMonth) hangoutsByMonth[key] += 1
    }
    for (const r of referencesInPeriod) {
      const key = new Date(r.createdAt).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (key in referencesByMonth) referencesByMonth[key] += 1
    }
    // Vibe breakdown — gives the qualitative trust signal that the raw
    // count can't. A spike in no_show is a different story from a spike
    // in good references.
    const vibeBreakdown = {
      good:    referencesInPeriod.filter(r => r.vibe === 'good').length,
      meh:     referencesInPeriod.filter(r => r.vibe === 'meh').length,
      noShow:  referencesInPeriod.filter(r => r.vibe === 'no_show').length,
    }
    // Top hosts of the period — bucket by userId, take top 5.
    const hostCounts = new Map<string, { count: number; user: typeof hangoutsInPeriod[0]['user'] }>()
    for (const h of hangoutsInPeriod) {
      const existing = hostCounts.get(h.userId)
      if (existing) existing.count++
      else hostCounts.set(h.userId, { count: 1, user: h.user })
    }
    const topHostsOfPeriod = [...hostCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(({ count, user }) => ({ ...user, count }))

    // ── Funnel ────────────────────────────────────────────────────────────────
    // Applications → Approved → First event (≥1 RSVP) → Repeat (≥2 RSVPs).
    // Reuse the repeatRsvpData groupBy (already in flight) instead of a new
    // query — distinct userId count = first-event tier, ≥2 = repeat tier.
    const funnel = {
      applications: allApps.length,
      approved:     allApps.filter(a => a.status === 'approved').length,
      firstEvent:   repeatRsvpData.length,
      repeat:       repeatRsvpData.filter(r => r._count.userId > 1).length,
    }

    // ── "Your First Event" matcher funnel ─────────────────────────────────────
    // Attribution for the newcomer recommendation block. Distinct members
    // shown a rec → clicked → RSVP'd (all-time since launch). rsvpRate is the
    // headline: does seeing a rec convert to RSVP above the signed-in→RSVP
    // baseline (~45%)? attended joins host-recorded check-ins, so treat it as
    // a floor, not an exact count. Separate queries — the main Promise.all is
    // already at TS's inference ceiling.
    const [femShown, femClicked, femRsvped] = await Promise.all([
      prisma.eventRecommendation.findMany({ distinct: ['userId'], select: { userId: true } }),
      prisma.eventRecommendation.findMany({ where: { clickedAt: { not: null } }, distinct: ['userId'], select: { userId: true } }),
      prisma.eventRecommendation.findMany({ where: { rsvpedAt:  { not: null } }, distinct: ['userId'], select: { userId: true } }),
    ])
    const femAttendedRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT r."userId") AS n
      FROM event_recommendations r
      JOIN event_attendees a
        ON a."userId" = r."userId" AND a."eventId" = r."eventId" AND a."checkedIn" = true`
    const femShownCount = femShown.length
    const firstEventMatcher = {
      shown:            femShownCount,
      clicked:          femClicked.length,
      rsvped:           femRsvped.length,
      attended:         Number(femAttendedRows[0]?.n ?? 0),
      clickRate:        femShownCount ? Math.round((femClicked.length / femShownCount) * 1000) / 10 : 0,
      rsvpRate:         femShownCount ? Math.round((femRsvped.length  / femShownCount) * 1000) / 10 : 0,
      baselineRsvpRate: 45.1,
    }

    // ── Cohort retention ─────────────────────────────────────────────────────
    // Group approved members by joinedAt month. Cohort count scales with the
    // period selector: 30d=1 cohort, 90d=3, 6m=6, 12m=12. For each cohort:
    // total size + % who attended an event within 30 / 90 days of joining +
    // % who ever attended. Onboarding-speed signal — flags cohorts where
    // new members aren't activating.
    const cohortMonthLabels: string[] = []
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      cohortMonthLabels.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))
    }
    // userId → joinedAt for fast cohort assignment
    const userJoin = new Map<string, Date>()
    for (const u of approved) userJoin.set((u as { id?: string }).id ?? '', new Date(u.joinedAt))
    // We didn't select id earlier — re-fetch a minimal users-with-id set so
    // cohort math has the join key. Cheap query, single table scan.
    const approvedWithId = await prisma.user.findMany({
      where:  { status: 'approved', role: { in: ['member', 'moderator'] } },
      // email added so we can match host-intent applications + acquisition-
      // source applications to actual user records via email join.
      // color/profilePhoto added so the host pipeline can render avatars
      // without an extra query.
      select: { id: true, joinedAt: true, email: true, name: true, color: true, profilePhoto: true, neighborhood: true, lastActive: true },
    })
    const userJoinById = new Map<string, Date>(approvedWithId.map((u: any) => [u.id, new Date(u.joinedAt)] as [string, Date]))
    // userId → first attendance date
    const firstAttendanceByUser = new Map<string, Date>()
    for (const a of allAttendees) {
      const existing = firstAttendanceByUser.get(a.userId)
      const d = new Date(a.joinedAt)
      if (!existing || d < existing) firstAttendanceByUser.set(a.userId, d)
    }
    const cohorts = cohortMonthLabels.map(label => {
      const cohortUsers = approvedWithId.filter((u: any) =>
        new Date(u.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) === label
      )
      const size = cohortUsers.length
      let within30 = 0, within90 = 0, ever = 0
      for (const u of cohortUsers) {
        const joined = userJoinById.get(u.id)!
        const first  = firstAttendanceByUser.get(u.id)
        if (!first) continue
        const daysToFirst = (first.getTime() - joined.getTime()) / 86400000
        ever++
        if (daysToFirst <= 90) within90++
        if (daysToFirst <= 30) within30++
      }
      return {
        cohort: label,
        size,
        within30Pct: size > 0 ? Math.round((within30 / size) * 100) : 0,
        within90Pct: size > 0 ? Math.round((within90 / size) * 100) : 0,
        everPct:    size > 0 ? Math.round((ever    / size) * 100) : 0,
      }
    })

    const result = {
      period: periodKey,
      periodLabel: period.label,
      months: monthKeys,
      members: {
        total: approved.length, newLast30, newPrev30, growthRate,
        byMonth: Object.values(memberByMonth),
      },
      engagement: {
        activeMemberCount,
        activeMemberRate,
        dormantCount,
        repeatRsvpRate,
        totalUniqueRsvpers,
        repeatRsvpers,
        dormantMembers: dormantMembers.map(u => ({
          id: u.id, name: u.name, joinedAt: u.joinedAt,
          interests: u.interests ?? [], neighborhood: u.neighborhood ?? null,
        })),
      },
      applications: {
        total: allApps.length, approved: appApproved, rejected: appRejected,
        pending: appPending, approvalRate,
        byMonth: Object.values(appByMonth),
        topInterests,
      },
      events: {
        total: allEvents.length, published: publishedEvents.length,
        past: pastEvents.length, upcoming: upcomingEvents.length,
        avgFillRate: avgFill, totalRsvps: allAttendees.length,
        byMonth: Object.values(eventByMonth),
        rsvpByMonth: Object.values(rsvpByMonth),
      },
      revenue: {
        collected: revenueCollected, pending: revenuePending, refunded: revenueRefunded,
        byMonth: Object.values(revenueByMonth),
      },
      reports: { pending: reportPending, actioned: reportActioned, dismissed: reportDismissed },
      topEvents: topEventsRaw.map(e => ({
        id: e.id, title: e.title, date: e.date, totalSpots: e.totalSpots,
        attending: e._count.attendees,
        fillRate: e.totalSpots > 0 ? Math.round((e._count.attendees / e.totalSpots) * 100) : 0,
      })),
      topClubs: topClubs.map(c => ({ id: c.id, name: c.name, emoji: c.emoji, members: c.memberCount, events: c._count.events })),
      neighborhoods: neighborhoodData,
      revenueByClub,
      refundRateByHost,
      interestAlignment: {
        fromApplications: topInterests,
        fromAttendedEvents: topAttendedInterests,
      },
      hangouts: {
        totals: {
          createdInPeriod:   hangoutsInPeriod.length,
          referencesInPeriod: referencesInPeriod.length,
        },
        byMonth:           Object.values(hangoutsByMonth),
        referencesByMonth: Object.values(referencesByMonth),
        vibeBreakdown,
        topHostsOfPeriod,
      },
      // Host pipeline — the Yasemin trap. Approved members who said
      // contribution: 'host' on their application but have hosted zero
      // events. Computed by matching applications.email to users.email,
      // then checking event count from the eventsByHost groupBy.
      hostPipeline: (() => {
        const userByEmail   = new Map<string, any>(approvedWithId.map((u: any) => [u.email, u] as [string, any]))
        const eventCountByHost = new Map<string, number>(
          (eventsByHost as { hostId: string | null; _count: { _all: number } }[])
            .filter(e => e.hostId)
            .map(e => [e.hostId!, e._count._all] as [string, number])
        )
        const pending = hostApplications.filter(a => a.status === 'pending').length
        const approvedHostUsers = hostApplications
          .filter(a => a.status === 'approved' && userByEmail.has(a.email))
          .map(a => {
            const user = userByEmail.get(a.email)!
            return {
              ...user,
              hostedCount: eventCountByHost.get(user.id) ?? 0,
              interests:   a.interests,
              joinedAt:    user.joinedAt,
            }
          })
        const neverHosted = approvedHostUsers.filter(u => u.hostedCount === 0)
        const activeHosts = approvedHostUsers.length - neverHosted.length
        return {
          pending,
          activeHosts,
          neverHostedCount: neverHosted.length,
          // Top 12 sorted by most-recently-joined-but-not-hosted; admins
          // can DM these directly to recover host capacity that fell through
          // the standard member onboarding.
          neverHosted: neverHosted
            .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
            .slice(0, 12)
            .map(u => ({
              id: u.id, name: u.name, color: u.color, profilePhoto: u.profilePhoto,
              neighborhood: u.neighborhood, joinedAt: u.joinedAt, lastActive: u.lastActive,
              interests: u.interests,
            })),
        }
      })(),
      // Acquisition source — where approved members say they came from
      // (friend / Instagram / search / etc.) plus the % who've attended ≥1
      // event. Surfaces which acquisition channels actually engage instead
      // of which ones just send people who bounce.
      sourceBreakdown: (() => {
        const userIdByEmail   = new Map<string, string>(approvedWithId.map((u: any) => [u.email, u.id] as [string, string]))
        const attendedUserIds = new Set(allAttendees.map(a => a.userId))
        const bucket: Record<string, { approved: number; attended: number }> = {}
        for (const app of approvedApps as { email: string; source: string | null }[]) {
          const key = app.source?.trim() || 'unknown'
          if (!bucket[key]) bucket[key] = { approved: 0, attended: 0 }
          bucket[key].approved++
          const uid = userIdByEmail.get(app.email)
          if (uid && attendedUserIds.has(uid)) bucket[key].attended++
        }
        return Object.entries(bucket)
          .map(([source, m]) => ({
            source,
            approved:      m.approved,
            attended:      m.attended,
            conversionPct: m.approved > 0 ? Math.round((m.attended / m.approved) * 100) : 0,
          }))
          .sort((a, b) => b.approved - a.approved)
      })(),
      funnel,
      firstEventMatcher,
      cohorts,
      // Health / moderation velocity — fleshes out the previously-thin Health
      // tab. Mean time to action is the headline mod-efficiency metric;
      // repeat offenders are the "spending most of moderation time on whom?"
      // signal; ban rate is the slow-moving denominator-aware trend.
      moderation: (() => {
        const reviewed   = reportsInPeriod.filter(r => r.reviewedAt)
        const meanHours  = reviewed.length === 0 ? null : Math.round(
          reviewed.reduce((s, r) => s + (new Date(r.reviewedAt!).getTime() - new Date(r.createdAt).getTime()), 0)
            / reviewed.length / (60 * 60 * 1000)
        )
        // Repeat offenders — users named in ≥2 reports this period.
        const reportCountByUser = new Map<string, number>()
        for (const r of reportsInPeriod) {
          reportCountByUser.set(r.reportedId, (reportCountByUser.get(r.reportedId) ?? 0) + 1)
        }
        const repeatOffenderCount = [...reportCountByUser.values()].filter(c => c >= 2).length
        const banRate = totalApprovedMembers > 0
          ? Math.round((bansInPeriod.length / totalApprovedMembers) * 10000) / 100  // 2 decimals
          : 0
        return {
          reportsInPeriod:     reportsInPeriod.length,
          actionedInPeriod:    reportsInPeriod.filter(r => r.status === 'actioned').length,
          dismissedInPeriod:   reportsInPeriod.filter(r => r.status === 'dismissed').length,
          meanHoursToAction:   meanHours,    // null if nothing was reviewed in period
          repeatOffenderCount,
          bansInPeriod:        bansInPeriod.length,
          banRatePct:          banRate,      // % of approved members banned this period
        }
      })(),
    }

    setCached(cacheKey, result, CACHE_TTL)
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
