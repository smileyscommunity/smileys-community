// Weekly read-only scan: member `neighborhood` values that don't match their
// city's registry, plus the cities that can't accept one yet.
//
//   npx tsx --env-file=.env scripts/scan-neighborhood-hygiene.ts
//
// With EMAIL_REPORT=1 (and .env.local for RESEND_API_KEY) the report is emailed
// to ADMIN_EMAIL — how the weekly cron delivers it (scripts/sweep-neighborhood-
// hygiene.sh, Mondays 06:20 UTC). Read-only: it never writes. The fix is
// scripts/fix-member-neighborhoods.ts, which shares this scan's classifier so
// "fixable" means the same thing in both.
//
// Why a scan when the write paths now validate: two of the four writers coerce
// instead of rejecting. Registration and application-approval drop an
// unrecognised neighborhood to NULL rather than failing, because a bad district
// must never be why an approved member can't finish signing up — so that loss
// is silent by design, and this is what surfaces it. The other reintroduction
// route is a city launching with no neighborhoods seeded, which no write-path
// check can detect.
//
// Reading the output:
//   • FIXABLE   — spelling/case only; fix-member-neighborhoods.ts resolves these
//   • ORPHANED  — matches nothing in that city (usually another city's district)
//   • AMBIGUOUS — two registry rows fold alike; a human picks, never the script
//   • NO REGISTRY — a live city with zero neighborhoods: members there cannot
//     set one at all, and its /neighborhoods page has nothing to show

import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'
import { classifyNeighborhoodValue } from '@/lib/neighborhoodsDb'
import { CITY_STATUS } from '@/lib/cityStatus'

const report: string[] = []
function log(line = '') {
  report.push(line)
  console.log(line)
}

async function main() {
  const cities = await prisma.city.findMany({
    select: { id: true, slug: true, status: true, _count: { select: { neighborhoods: true } } },
    orderBy: { slug: 'asc' },
  })
  const cityBySlug = new Map(cities.map(c => [c.id, c]))

  const members = await prisma.user.findMany({
    where:  { neighborhood: { not: null } },
    select: { id: true, name: true, cityId: true, neighborhood: true, status: true },
  })

  const fixable:   string[] = []
  const orphaned:  string[] = []
  const ambiguous: string[] = []

  for (const m of members) {
    const verdict = await classifyNeighborhoodValue(m.cityId, m.neighborhood)
    const city    = cityBySlug.get(m.cityId)?.slug ?? m.cityId
    const who     = `${city.padEnd(9)} ${m.name}${m.status === 'approved' ? '' : ` [${m.status}]`}`
    if (verdict.kind === 'valid' || verdict.kind === 'blank') continue
    if (verdict.kind === 'canonical')      fixable.push(`${who}: ${JSON.stringify(m.neighborhood)} → ${JSON.stringify(verdict.name)}`)
    else if (verdict.kind === 'ambiguous') ambiguous.push(`${who}: ${JSON.stringify(m.neighborhood)} → ${verdict.matches.join(' / ')}`)
    else                                   orphaned.push(`${who}: ${JSON.stringify(m.neighborhood)}`)
  }

  // A live city with no registry is its own defect: nobody there can pick a
  // neighborhood, so the feature is dark for that whole city.
  const noRegistry = cities.filter(c => c.status === CITY_STATUS.Live && c._count.neighborhoods === 0)

  const broken = fixable.length + orphaned.length + ambiguous.length
  log(`Neighborhood hygiene — ${members.length} members with a value set, ${broken} not matching their city`)
  log()

  const section = (label: string, rows: string[]) => {
    if (!rows.length) return
    log(`${label} (${rows.length})`)
    for (const r of rows) log(`   ${r}`)
    log()
  }

  section('FIXABLE ⚠️  — run scripts/fix-member-neighborhoods.ts', fixable)
  section('ORPHANED ⚠️  — no neighborhood of that city matches; CLEAR_UNMATCHED=1 nulls them', orphaned)
  section('AMBIGUOUS ⚠️  — decide by hand', ambiguous)

  if (noRegistry.length) {
    log(`NO REGISTRY ⚠️  — live cities where no member can set a neighborhood (${noRegistry.length})`)
    for (const c of noRegistry) log(`   ${c.slug}`)
    log()
  }

  if (!broken && !noRegistry.length) log('All clear — every stored neighborhood matches its city.')
}

async function emailReport() {
  if (process.env.EMAIL_REPORT !== '1') return
  const to = process.env.ADMIN_EMAIL
  if (!to || !process.env.RESEND_API_KEY) {
    console.error('EMAIL_REPORT=1 but ADMIN_EMAIL/RESEND_API_KEY missing')
    return
  }
  // Count the flagged SECTIONS' rows, not lines containing the marker, so the
  // subject can't drift from the body.
  const flagged = report.filter(l => l.startsWith('   ') && l.includes(':')).length
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>',
    to,
    subject: `Weekly neighborhood hygiene: ${flagged ? `${flagged} member(s) need a fix ⚠️` : 'all clear ✅'}`,
    text: report.join('\n'),
  })
  console.log(`report emailed to ADMIN_EMAIL (${flagged} flagged)`)
}

main()
  .then(emailReport)
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
