// Give application audit rows their city.
//
// lib/audit.ts resolves an audit row's city from its target, but its table had
// no 'memberApplication' case, so every application approve/reject was written
// with cityId null (104 rows in the 2026-09 production audit) — and a
// moderator's city-scoped audit view never showed their own city's decisions.
// The route now passes the city and the resolver knows the type; this fills in
// the rows written before.
//
// A row is resolvable when its application (targetId, else meta.applicationId /
// meta.id) still exists and has a target city. Everything else is listed as
// UNRESOLVABLE and never written.
//
//   DRY_RUN (default): list every row with its proposed city, write nothing.
//   APPLY=1:           set the city, guarded WHERE id=… AND "cityId" IS NULL, so a
//                      re-run (or a row fixed meanwhile) is a no-op.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/repair-application-audit-city.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/repair-application-audit-city.ts

export type AuditRow = {
  id:         string
  action:     string
  targetId:   string | null
  targetType: string | null
  meta:       unknown
  createdAt:  Date
}
export type AppCity = { id: string; targetCityId: string | null }

export type AuditCityPlan =
  | { auditId: string; action: string; createdAt: Date; applicationId: string; status: 'RESOLVABLE'; cityId: string }
  | { auditId: string; action: string; createdAt: Date; applicationId: string | null; status: 'UNRESOLVABLE'; reason: 'no_application_id' | 'application_gone' | 'application_has_no_city' }

/** Which rows are application decisions: the target type, or the action family for rows with another/no type. */
export function isApplicationAuditRow(r: Pick<AuditRow, 'action' | 'targetType'>): boolean {
  return r.targetType === 'memberApplication' || r.action.startsWith('application.')
}

/** The application an audit row is about. */
export function applicationIdOf(r: Pick<AuditRow, 'targetId' | 'meta'>): string | null {
  if (r.targetId) return r.targetId
  const meta = (r.meta && typeof r.meta === 'object') ? r.meta as Record<string, unknown> : {}
  for (const k of ['applicationId', 'id']) {
    if (typeof meta[k] === 'string' && meta[k]) return meta[k] as string
  }
  return null
}

export function planAuditCityRepairs(rows: AuditRow[], apps: AppCity[]): AuditCityPlan[] {
  const byId = new Map(apps.map(a => [a.id, a]))
  return rows.filter(isApplicationAuditRow).map((r): AuditCityPlan => {
    const base = { auditId: r.id, action: r.action, createdAt: r.createdAt }
    const applicationId = applicationIdOf(r)
    if (!applicationId) return { ...base, applicationId: null, status: 'UNRESOLVABLE', reason: 'no_application_id' }
    const app = byId.get(applicationId)
    if (!app) return { ...base, applicationId, status: 'UNRESOLVABLE', reason: 'application_gone' }
    if (!app.targetCityId) return { ...base, applicationId, status: 'UNRESOLVABLE', reason: 'application_has_no_city' }
    return { ...base, applicationId, status: 'RESOLVABLE', cityId: app.targetCityId }
  })
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const APPLY = process.env.APPLY === '1'

  const rows = await prisma.auditLog.findMany({
    where:   { cityId: null, OR: [{ targetType: 'memberApplication' }, { action: { startsWith: 'application.' } }] },
    select:  { id: true, action: true, targetId: true, targetType: true, meta: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const ids  = [...new Set(rows.map(applicationIdOf).filter((x): x is string => !!x))]
  const apps = ids.length
    ? await prisma.memberApplication.findMany({ where: { id: { in: ids } }, select: { id: true, targetCityId: true } })
    : []
  const cities = new Map((await prisma.city.findMany({ select: { id: true, slug: true } })).map(c => [c.id, c.slug]))

  const plan    = planAuditCityRepairs(rows, apps)
  const fixable = plan.filter(p => p.status === 'RESOLVABLE')
  const stuck   = plan.filter(p => p.status === 'UNRESOLVABLE')

  // Full lists, never truncated.
  console.log(`\nRESOLVABLE (${fixable.length})`)
  for (const p of fixable) {
    console.log(`  ${p.auditId}  ${p.createdAt.toISOString()}  ${p.action.padEnd(22)} application ${p.applicationId} → ${p.cityId} (${cities.get(p.cityId) ?? 'unknown city'})`)
  }
  console.log(`\nUNRESOLVABLE (${stuck.length}) — never written`)
  for (const p of stuck) {
    console.log(`  ${p.auditId}  ${p.createdAt.toISOString()}  ${p.action.padEnd(22)} application ${p.applicationId ?? '—'}  ${p.status === 'UNRESOLVABLE' ? p.reason : ''}`)
  }
  const byCity = new Map<string, number>()
  for (const p of fixable) byCity.set(p.cityId, (byCity.get(p.cityId) ?? 0) + 1)
  console.log(`\ncounts: rows=${plan.length} resolvable=${fixable.length} unresolvable=${stuck.length}`)
  for (const [c, n] of byCity) console.log(`  ${cities.get(c) ?? c}: ${n}`)

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with APPLY=1 to set ${fixable.length} cit${fixable.length === 1 ? 'y' : 'ies'}.`)
    await prisma.$disconnect()
    return
  }

  let updated = 0, skipped = 0
  for (const p of fixable) {
    const { count } = await prisma.auditLog.updateMany({ where: { id: p.auditId, cityId: null }, data: { cityId: p.cityId } })
    if (count) updated++; else skipped++
  }
  console.log(`\nAPPLY — updated ${updated} of ${fixable.length}; ${skipped} already had a city or were gone.`)
  await prisma.$disconnect()
}

if (/repair-application-audit-city\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 })
}
