// Retention for sponsor / partnership leads: removes the PERSONAL contact
// details from leads that have sat untouched past a period you choose, and
// keeps what the business record needs (company, format, status, deal value).
//
// What it scrubs: name → '[removed]', email → 'removed@invalid', message →
// '[removed]', eventWebsite/adminNotes → null. Sets scrubbedAt, so a row is
// never processed twice and the admin shows "Contact removed".
//
// What it never touches: a lead updated within RETENTION_DAYS; any lead in
// status 'negotiating' (a live conversation); the company/format/status/deal
// columns (revenue history survives).
//
// There is deliberately NO default period — it is a privacy-policy decision
// (Nate's, not the code's), so RETENTION_DAYS must be given. Dry run first:
//
//   DRY_RUN=1 RETENTION_DAYS=730 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/scrub-old-sponsor-leads.ts
//
// Not scheduled. Run by hand, or add a cron once the period is decided.
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

async function main() {
  const days = Number(process.env.RETENTION_DAYS)
  if (!Number.isInteger(days) || days < 90) throw new Error('Set RETENTION_DAYS to a whole number of days (90 or more) — there is no default.')
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const dry = process.env.DRY_RUN === '1'

  const where = { scrubbedAt: null, updatedAt: { lt: cutoff }, status: { not: 'negotiating' } } as const
  const rows = await prisma.sponsorLead.findMany({ where, select: { id: true, company: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'asc' } })
  console.log(`${rows.length} lead(s) untouched since ${cutoff.toISOString().slice(0, 10)} (${days} days)`)
  for (const r of rows.slice(0, 30)) console.log(`  ${r.updatedAt.toISOString().slice(0, 10)}  ${r.status.padEnd(11)} ${r.company}`)
  if (rows.length > 30) console.log(`  … and ${rows.length - 30} more`)
  if (dry || rows.length === 0) return console.log(dry ? 'DRY_RUN — nothing written' : 'nothing to do')

  // Guarded on the same condition, so a lead touched since the read is skipped.
  const res = await prisma.sponsorLead.updateMany({
    where: { ...where, id: { in: rows.map(r => r.id) } },
    data: { name: '[removed]', email: 'removed@invalid', message: '[removed]', eventWebsite: null, adminNotes: null, scrubbedAt: new Date() },
  })
  await writeAudit('system', 'retention script', 'sponsor_lead.scrub', 'batch', 'sponsor_lead', { count: res.count, retentionDays: days })
  console.log(`scrubbed ${res.count} lead(s)`)
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) }).finally(() => prisma.$disconnect())
