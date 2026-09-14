// Remove club memberships an application approval created in ANOTHER city's
// club. Until the approval route learned to filter assigned clubs by city
// (lib/approvalClubs), a hand-picked club passed straight through, and nine
// members approved into Antalya and İzmir landed in a default-city club.
//
// Only memberships the approval itself created are removed: the club is in
// that application's assignedClubs AND the membership row was written within
// a minute of the application's reviewedAt (approval creates the account and
// its memberships in the same request). Anything that can't be pinned to the
// approval is listed as UNSURE or SELF_JOINED and never touched:
//   · assigned, but the row was written with a later registration (the
//     register route enrols assigned clubs AND onboarding picks together)
//   · assigned, but the row is much later than the approval
//   · the club isn't in the application's assigned list at all
//   · the member also applied to, or has since joined, the club's city
//     (those don't show up here at all when they now live in that city)
//
// Club.memberCount is decremented in the same transaction as each delete,
// by the shared rule (lib/clubMemberCount: approved row, user not banned),
// so counts are right immediately rather than after the nightly recount.
// No member is notified.
//
//   DRY_RUN (default): list what would be removed, write nothing.
//   APPLY=1:           remove the APPROVAL rows.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/repair-cross-city-club-assignments.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/repair-cross-city-club-assignments.ts

export const APPROVAL_WINDOW_MS = 60_000

export type PlanApplication = { id: string; email: string; targetCityId: string; assignedClubs: string[]; reviewedAt: Date | null }
export type PlanUser        = { id: string; name: string | null; email: string; cityId: string; status: string; joinedAt: Date }
export type PlanMembership  = { id: string; userId: string; clubId: string; status: string; joinedAt: Date; clubName: string; clubCityId: string | null }

export type PlanRow = {
  membershipId:      string
  userId:            string
  initial:           string
  memberCityId:      string
  applicationId:     string
  applicationCityId: string
  clubId:            string
  clubName:          string
  clubCityId:        string
  joinedAt:          Date
  origin:            'APPROVAL' | 'UNSURE' | 'SELF_JOINED'
  note:              string
}

const initialOf = (name: string | null) => (Array.from((name ?? '').trim())[0] ?? '?') + '.'
const within = (a: Date, b: Date, ms: number) => Math.abs(a.getTime() - b.getTime()) <= ms

/**
 * Pure: every membership of an approved applicant in a city-scoped club
 * outside the member's own cities, classified by how it was created. Only
 * APPROVAL rows are ever removed (see repairTargets).
 */
export function planCrossCityRepairs(input: {
  applications: PlanApplication[]   // approved applications only
  users:        PlanUser[]
  memberships:  PlanMembership[]
  joinedCities: { userId: string; cityId: string }[]   // CityRelationship type 'member'
}, windowMs = APPROVAL_WINDOW_MS): PlanRow[] {
  const appsByEmail = new Map<string, PlanApplication[]>()
  for (const a of input.applications) {
    const key = a.email.trim().toLowerCase()
    appsByEmail.set(key, [...(appsByEmail.get(key) ?? []), a])
  }
  const usersById = new Map(input.users.map(u => [u.id, u]))
  const joined = new Set(input.joinedCities.map(j => `${j.userId}:${j.cityId}`))

  const rows: PlanRow[] = []
  for (const m of input.memberships) {
    const user = usersById.get(m.userId)
    if (!user || !m.clubCityId) continue                                   // global clubs are fine anywhere
    if (m.clubCityId === user.cityId || joined.has(`${user.id}:${m.clubCityId}`)) continue
    const apps = appsByEmail.get(user.email.trim().toLowerCase()) ?? []
    if (!apps.length) continue                                             // not an approved applicant

    const assigning = apps.filter(a => a.assignedClubs.includes(m.clubId))
    const latest    = [...apps].sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))[0]
    const byApproval = assigning.find(a => a.reviewedAt && within(m.joinedAt, a.reviewedAt, windowMs))
    const app = byApproval ?? assigning[0] ?? latest

    const base = {
      membershipId: m.id, userId: user.id, initial: initialOf(user.name), memberCityId: user.cityId,
      applicationId: app.id, applicationCityId: app.targetCityId,
      clubId: m.clubId, clubName: m.clubName, clubCityId: m.clubCityId, joinedAt: m.joinedAt,
    }
    const push = (origin: PlanRow['origin'], note: string) => rows.push({ ...base, origin, note })

    if (apps.some(a => a.targetCityId === m.clubCityId)) push('UNSURE', "member also applied to the club's city")
    else if (m.status !== 'approved')                       push('UNSURE', `membership is ${m.status}, not approved`)
    else if (byApproval)                                     push('APPROVAL', `assigned, written within ${Math.round(windowMs / 1000)}s of approval`)
    else if (assigning.length && within(m.joinedAt, user.joinedAt, windowMs))
                                                             push('UNSURE', 'assigned, but written at registration (assignment or onboarding pick)')
    else if (assigning.length)                               push('UNSURE', 'assigned, but written long after approval')
    else                                                     push('SELF_JOINED', "not in the application's assigned clubs")
  }
  return rows
}

/** The only rows APPLY=1 touches. */
export const repairTargets = (rows: PlanRow[]) => rows.filter(r => r.origin === 'APPROVAL')

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const APPLY = process.env.APPLY === '1'

  const applications = await prisma.memberApplication.findMany({
    where:  { status: 'approved' },
    select: { id: true, email: true, targetCityId: true, assignedClubs: true, reviewedAt: true },
  })
  const emails = [...new Set(applications.map(a => a.email.trim().toLowerCase()))]
  const users = await prisma.user.findMany({
    where:  { email: { in: emails, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, cityId: true, status: true, joinedAt: true },
  })
  const userIds = users.map(u => u.id)
  const [memberships, joinedCities, cities] = await Promise.all([
    prisma.clubMembership.findMany({
      where:  { userId: { in: userIds }, club: { cityId: { not: null } } },
      select: { id: true, userId: true, clubId: true, status: true, joinedAt: true, club: { select: { name: true, cityId: true } } },
    }),
    prisma.cityRelationship.findMany({ where: { userId: { in: userIds }, type: 'member' }, select: { userId: true, cityId: true } }),
    prisma.city.findMany({ select: { id: true, name: true } }),
  ])
  const cityName = new Map(cities.map(c => [c.id, c.name]))
  const city = (id: string) => cityName.get(id) ?? id

  const rows = planCrossCityRepairs({
    applications, users, joinedCities,
    memberships: memberships.map(m => ({ id: m.id, userId: m.userId, clubId: m.clubId, status: m.status, joinedAt: m.joinedAt, clubName: m.club.name, clubCityId: m.club.cityId })),
  })

  // Full list, never truncated.
  for (const r of rows) {
    console.log(`${r.origin.padEnd(11)} member ${r.userId} (${r.initial}) in ${city(r.memberCityId)} [applied: ${city(r.applicationCityId)}] — club "${r.clubName}" (${r.clubId}) in ${city(r.clubCityId)} — membership ${r.membershipId} joined ${r.joinedAt.toISOString()} — ${r.note}`)
  }
  const targets = repairTargets(rows)
  const tally = (o: PlanRow['origin']) => rows.filter(r => r.origin === o).length
  console.log(`\n${rows.length} cross-city memberships: ${tally('APPROVAL')} APPROVAL, ${tally('UNSURE')} UNSURE, ${tally('SELF_JOINED')} SELF_JOINED.`)

  if (!APPLY) {
    console.log(`DRY RUN — ${targets.length} APPROVAL membership(s) would be removed. Re-run with APPLY=1 to write.`)
    return
  }

  let removed = 0, decremented = 0, gone = 0
  for (const r of targets) {
    const outcome = await prisma.$transaction(async tx => {
      const current = await tx.clubMembership.findFirst({
        where:  { id: r.membershipId, clubId: r.clubId, userId: r.userId },
        select: { status: true, user: { select: { status: true } } },
      })
      if (!current) return 'gone' as const
      // Guarded on all three ids: a row re-created or re-keyed since the plan is left alone.
      const del = await tx.clubMembership.deleteMany({ where: { id: r.membershipId, clubId: r.clubId, userId: r.userId } })
      if (del.count !== 1) return 'gone' as const
      // Same rule the counter and the recount use (lib/clubMemberCount): a
      // banned member's row was already taken off by the ban.
      if (current.status !== 'approved' || current.user.status === 'banned') return 'removed' as const
      await tx.club.updateMany({ where: { id: r.clubId, memberCount: { gt: 0 } }, data: { memberCount: { decrement: 1 } } })
      return 'decremented' as const
    })
    if (outcome === 'gone') { gone++; continue }
    removed++
    if (outcome === 'decremented') decremented++
    console.log(`removed membership ${r.membershipId} (member ${r.userId}, club ${r.clubId})${outcome === 'decremented' ? ', memberCount −1' : ''}`)
  }
  console.log(`\nAPPLY — removed ${removed} of ${targets.length}; memberCount decremented ${decremented}; ${gone} already gone.`)
  await prisma.$disconnect()
}

// Only run as a CLI: planCrossCityRepairs is exported and unit-tested, and an
// import must not fire the repair as a side effect.
if (/repair-cross-city-club-assignments\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 })
}
