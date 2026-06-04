// One-off audit: reports every approved+active directory entry that's
// missing key contact info (phone OR address OR website). Outputs a
// markdown checklist with a Google Maps search link per row so the
// admin can verify each entry against the real Istanbul map and
// either fill it in via /admin/directory or delete it if it doesn't
// actually exist.
//
// Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/audit-directory-verification.ts' > directory-audit.md
//
// Or locally pointed at prod by setting DATABASE_URL.

import { prisma } from '@/lib/prisma'

function gmapsLink(name: string, neighborhood: string | null): string {
  // Quote the name so Maps treats it as a single phrase, then add
  // neighborhood + Istanbul context. URLencoding is required since
  // names + neighborhoods contain non-ASCII characters (Cihangir,
  // Şişli, Kadıköy, etc.).
  const q = neighborhood ? `"${name}" ${neighborhood} Istanbul` : `"${name}" Istanbul`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

function adminLink(id: string): string {
  return `https://smileyscommunity.com/app/admin/directory?status=approved#${id}`
}

async function main() {
  const businesses = await prisma.business.findMany({
    where: { isApproved: true, isActive: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, category: true, neighborhood: true,
      phone: true, address: true, website: true, instagram: true,
      latitude: true, longitude: true,
      submittedBy: { select: { name: true } },
    },
  })

  // "Incomplete" = missing any of the three primary signals (phone,
  // address, website). instagram and lat/lon are nice-to-have but
  // don't gate verification — Google Maps gives us a way to check
  // existence regardless.
  const incomplete = businesses.filter(b => !b.phone || !b.address || !b.website)

  const total = businesses.length
  const noPhone   = businesses.filter(b => !b.phone).length
  const noAddress = businesses.filter(b => !b.address).length
  const noWebsite = businesses.filter(b => !b.website).length
  const noLatLon  = businesses.filter(b => b.latitude == null || b.longitude == null).length
  const noInsta   = businesses.filter(b => !b.instagram).length
  const fullySet  = businesses.filter(b => b.phone && b.address && b.website).length

  const lines: string[] = []
  lines.push('# Directory verification checklist')
  lines.push('')
  lines.push(`_Generated: ${new Date().toISOString()}_`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`| Metric | Count |`)
  lines.push(`|---|---|`)
  lines.push(`| Total approved + active entries | **${total}** |`)
  lines.push(`| Fully populated (phone + address + website) | **${fullySet}** |`)
  lines.push(`| Missing phone | ${noPhone} |`)
  lines.push(`| Missing address | ${noAddress} |`)
  lines.push(`| Missing website | ${noWebsite} |`)
  lines.push(`| Missing Instagram | ${noInsta} |`)
  lines.push(`| Missing lat/lon (precise map pin) | ${noLatLon} |`)
  lines.push(`| **Entries needing at least one fix** | **${incomplete.length}** |`)
  lines.push('')
  lines.push('## How to use this checklist')
  lines.push('')
  lines.push('For each entry below:')
  lines.push('')
  lines.push('1. Click the **Google Maps** link to verify the business actually exists at the indicated neighborhood.')
  lines.push('2. **If real** → open `/admin/directory?status=approved`, find the entry, click **Edit**, paste in real phone / address / website / lat / lon.')
  lines.push('3. **If fake** (no real match in Maps) → click **Delete** on the entry to keep the directory honest.')
  lines.push('4. Tick the box here to mark the row done.')
  lines.push('')

  // Group by category for readability.
  const byCategory = new Map<string, typeof incomplete>()
  for (const b of incomplete) {
    if (!byCategory.has(b.category)) byCategory.set(b.category, [])
    byCategory.get(b.category)!.push(b)
  }

  for (const [category, items] of Array.from(byCategory.entries()).sort()) {
    lines.push(`## ${category} (${items.length})`)
    lines.push('')
    for (const b of items) {
      const missing: string[] = []
      if (!b.phone)    missing.push('phone')
      if (!b.address)  missing.push('address')
      if (!b.website)  missing.push('website')
      const where = b.neighborhood ?? '_(no neighborhood)_'
      lines.push(`- [ ] **${b.name}** — ${where} — missing: ${missing.join(', ')} · [Google Maps](${gmapsLink(b.name, b.neighborhood)})`)
    }
    lines.push('')
  }

  if (incomplete.length === 0) {
    lines.push('## 🎉 All entries fully populated')
    lines.push('')
    lines.push('Nothing to verify — every approved + active row has phone, address, and website set.')
  }

  console.log(lines.join('\n'))
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
