// Read-only audit of the small hygiene leftovers from the 2026-09 production
// scan: memberships in inactive clubs (46) and the one-off payment, review and
// audit-log rows whose parent is gone. No writes, no APPLY mode — each finding
// needs a human call (reactivate the club? move members? keep for finance?).
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-hygiene-orphans.ts
//
// Prints ids, statuses and counts only — no names, emails or text.

import { prisma } from '@/lib/prisma'

// ── Memberships in inactive clubs ──────────────────────────────────────────
export interface InactiveMembership {
  id: string; clubId: string; clubName: string; userId: string
  status: string; role: string; userStatus: string
}

// Where such a membership still surfaces to the member, per the code as of
// 2026-09-14. The club page itself 404s for an inactive club
// (app/(member)/clubs/[slug]/page.tsx filters isActive), which is why a
// visible row is a dead end rather than a working link.
export function membershipVisibility(m: Pick<InactiveMembership, 'status' | 'role' | 'userStatus'>): string[] {
  if (m.userStatus === 'banned') return []
  if (m.status !== 'approved') return []
  const out = ['dashboard "your clubs" (app/(member)/dashboard/page.tsx has no isActive filter) → club page 404s']
  if (m.role === 'host') {
    out.push('still a club host: isClubHost (lib/access.ts) has no isActive filter → host privileges (message anyone, full directory)')
    out.push('profile "hosts" badge (app/api/members/[id]/route.ts)')
  }
  return out
}

// ── Audit rows whose target is gone ────────────────────────────────────────
// targetType → table. Only types whose table name is certain; others are skipped.
export const AUDIT_TARGET_TABLES: Record<string, string> = {
  user: 'users', event: 'events', club: 'clubs', business: 'businesses',
  payment: 'payments', testimonial: 'testimonials',
}

// A target missing because the logged action removed it is the audit trail
// working, not an orphan.
export function isExpectedAuditOrphan(action: string): boolean {
  return /(remove|delete)/i.test(action)
}

export interface ParentOrphan { id: string; status?: string; parentMissing: string[] }
export interface AuditOrphan { id: string; action: string; targetType: string; targetId: string }

/** Pure: groups every finding and counts it. */
export function planHygieneOrphans(input: {
  inactiveMemberships: InactiveMembership[]
  paymentOrphans:      ParentOrphan[]
  reviewOrphans:       ParentOrphan[]
  auditOrphans:        AuditOrphan[]
}) {
  const memberships = input.inactiveMemberships.map(m => ({ ...m, visibleTo: membershipVisibility(m) }))
  const unexpectedAudit = input.auditOrphans.filter(a => !isExpectedAuditOrphan(a.action))
  const expectedByAction: Record<string, number> = {}
  for (const a of input.auditOrphans) {
    if (isExpectedAuditOrphan(a.action)) expectedByAction[a.action] = (expectedByAction[a.action] ?? 0) + 1
  }
  return {
    memberships,
    paymentOrphans: input.paymentOrphans,
    reviewOrphans:  input.reviewOrphans,
    unexpectedAudit,
    expectedByAction,
    counts: {
      inactiveMemberships:        memberships.length,
      inactiveMembershipsVisible: memberships.filter(m => m.visibleTo.length > 0).length,
      inactiveHosts:              memberships.filter(m => m.role === 'host' && m.status === 'approved').length,
      paymentOrphans:             input.paymentOrphans.length,
      reviewOrphans:              input.reviewOrphans.length,
      auditOrphansUnexpected:     unexpectedAudit.length,
      auditOrphansExpected:       input.auditOrphans.length - unexpectedAudit.length,
    },
  }
}

async function load() {
  const inactive = await prisma.clubMembership.findMany({
    where:  { club: { isActive: false } },
    select: { id: true, clubId: true, userId: true, status: true, role: true, club: { select: { name: true } }, user: { select: { status: true } } },
  })

  // FKs should make these impossible; LEFT JOINs prove it rather than assume
  // it (rows written before a constraint existed survive it).
  const payments = await prisma.$queryRaw<{ id: string; status: string; eventMissing: boolean; userMissing: boolean }[]>`
    SELECT p.id, p.status, (e.id IS NULL) AS "eventMissing", (u.id IS NULL) AS "userMissing"
    FROM payments p
    LEFT JOIN events e ON e.id = p."eventId"
    LEFT JOIN users  u ON u.id = p."userId"
    WHERE e.id IS NULL OR u.id IS NULL`
  const reviews = await prisma.$queryRaw<{ id: string; eventMissing: boolean; userMissing: boolean }[]>`
    SELECT r.id, (e.id IS NULL) AS "eventMissing", (u.id IS NULL) AS "userMissing"
    FROM reviews r
    LEFT JOIN events e ON e.id = r."eventId"
    LEFT JOIN users  u ON u.id = r."userId"
    WHERE e.id IS NULL OR u.id IS NULL`

  const auditOrphans: AuditOrphan[] = []
  for (const [targetType, table] of Object.entries(AUDIT_TARGET_TABLES)) {
    // Table name comes from the constant map above, never from input.
    const rows = await prisma.$queryRawUnsafe<{ id: string; action: string; targetId: string }[]>(
      `SELECT a.id, a.action, a."targetId" FROM audit_logs a
       LEFT JOIN ${table} t ON t.id = a."targetId"
       WHERE a."targetType" = $1 AND a."targetId" IS NOT NULL AND t.id IS NULL`,
      targetType,
    )
    for (const r of rows) auditOrphans.push({ ...r, targetType })
  }

  const missing = (r: { eventMissing: boolean; userMissing: boolean }) =>
    [r.eventMissing && 'event', r.userMissing && 'user'].filter((x): x is string => !!x)

  return {
    inactiveMemberships: inactive.map(m => ({ id: m.id, clubId: m.clubId, clubName: m.club.name, userId: m.userId, status: m.status, role: m.role, userStatus: m.user.status })),
    paymentOrphans:      payments.map(p => ({ id: p.id, status: p.status, parentMissing: missing(p) })),
    reviewOrphans:       reviews.map(r => ({ id: r.id, parentMissing: missing(r) })),
    auditOrphans,
  }
}

async function main() {
  console.log('READ-ONLY — nothing is written.\n')
  const plan = planHygieneOrphans(await load())

  // Every row, never truncated.
  console.log('Memberships in inactive clubs:')
  for (const m of plan.memberships) {
    console.log(`  ${m.id} club=${m.clubId} "${m.clubName}" user=${m.userId} ${m.role}/${m.status} userStatus=${m.userStatus}`)
    console.log(`      shows: ${m.visibleTo.length ? m.visibleTo.join('; ') : 'nowhere member-facing'}`)
  }
  console.log('\nPayments whose parent is gone:')
  for (const p of plan.paymentOrphans) console.log(`  ${p.id} status=${p.status} missing=${p.parentMissing.join('+')}`)
  console.log('\nReviews whose parent is gone:')
  for (const r of plan.reviewOrphans) console.log(`  ${r.id} missing=${r.parentMissing.join('+')}`)
  console.log('\nAudit rows whose target is gone (action did not remove it):')
  for (const a of plan.unexpectedAudit) console.log(`  ${a.id} ${a.action} ${a.targetType}=${a.targetId}`)
  console.log(`\nAudit rows whose target is gone because the action removed it (expected), by action:`)
  for (const [action, n] of Object.entries(plan.expectedByAction).sort()) console.log(`  ${action}: ${n}`)

  const c = plan.counts
  console.log(`\nsummary: inactiveMemberships=${c.inactiveMemberships} (visible to member=${c.inactiveMembershipsVisible}, approved hosts=${c.inactiveHosts})` +
    ` paymentOrphans=${c.paymentOrphans} reviewOrphans=${c.reviewOrphans}` +
    ` auditOrphans unexpected=${c.auditOrphansUnexpected} expected=${c.auditOrphansExpected}`)
  console.log(`audit target types checked: ${Object.keys(AUDIT_TARGET_TABLES).join(', ')}`)
}

// Only run as a CLI — tests import the planners.
if (/audit-hygiene-orphans\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
