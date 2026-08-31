// One-off: seed search tags on the existing Handbook articles.
//
// The homepage search matches on title + excerpt + tags. Titles are English,
// but members search in the vocabulary they actually use — "ikamet", "vergi
// numarası", "eczane", "kreş" — so each article gets the Turkish terms and
// common synonyms its title doesn't contain. (Matching is diacritic-folded,
// so tags are stored in natural spelling.)
//
// Guarded: only articles whose tags are still empty are touched, so tags
// curated later in the admin are never overwritten by a re-run.
//
// Dry run by default:
//   npx tsx --env-file=.env --env-file=.env.local scripts/backfill-handbook-tags.ts
// Apply:
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/backfill-handbook-tags.ts
import { prisma } from '../../lib/prisma'

const APPLY = process.env.APPLY === '1'

const TAGS: Record<string, string[]> = {
  'istanbulkart-mastery': [
    'istanbulkart', 'metro', 'tram', 'bus', 'ferry', 'vapur', 'marmaray',
    'metrobüs', 'transport', 'airport', 'havalimanı', 'fares', 'bilet', 'akbil',
  ],
  'opening-turkish-bank-account': [
    'bank', 'banking', 'banka', 'hesap', 'iban', 'tax number', 'vergi numarası',
    'ziraat', 'garanti', 'kuveyt türk', 'enpara', 'money', 'transfer', 'wise', 'atm',
  ],
  'residence-permit-first-application': [
    'ikamet', 'residence permit', 'visa', 'vize', 'göç idaresi', 'e-ikamet',
    'immigration', 'tax number', 'vergi numarası', 'appointment', 'randevu',
    'health insurance', 'sigorta',
  ],
  'healthcare-in-istanbul-how-the-system-works': [
    'doctor', 'doktor', 'hospital', 'hastane', 'pharmacy', 'eczane', 'nöbetçi',
    'mhrs', 'sgk', 'insurance', 'sigorta', 'emergency', 'acil', '112', 'health',
  ],
  'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid': [
    'scam', 'safety', 'taxi', 'taksi', 'tourist trap', 'police', 'polis',
    'emergency', 'acil', '112', 'atm', 'theft', 'fraud', 'dolandırıcılık',
  ],
  'daily-life-in-istanbul-the-little-things-that-make-a-big-difference': [
    'apartment', 'rent', 'kira', 'ev', 'utilities', 'electricity', 'elektrik',
    'water', 'su', 'internet', 'sim', 'phone', 'telefon', 'groceries', 'market',
    'pazar', 'delivery', 'pets', 'aidat',
  ],
  'family-life-in-istanbul-raising-children-with-confidence': [
    'school', 'okul', 'kreş', 'anaokulu', 'children', 'kids', 'çocuk', 'family',
    'aile', 'education', 'university', 'üniversite', 'vaccination', 'aşı',
  ],
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — writing to the database\n' : '🔍 DRY RUN — no writes (set APPLY=1 to commit)\n')

  for (const [slug, tags] of Object.entries(TAGS)) {
    const post = await prisma.post.findUnique({ where: { slug }, select: { id: true, tags: true } })
    if (!post) { console.log(`✗ ${slug} not found`); continue }
    if (post.tags.length > 0) { console.log(`· ${slug}: already has ${post.tags.length} tags — left untouched`); continue }
    console.log(`▸ ${slug}: +${tags.length} tags`)
    if (APPLY) {
      await prisma.post.updateMany({
        // isEmpty re-checks the guard at write time, so a concurrent admin
        // edit can't be clobbered between the read above and this update.
        where: { id: post.id, tags: { isEmpty: true } },
        data:  { tags },
      })
    }
  }

  console.log('\nDone.' + (APPLY ? '' : ' Re-run with APPLY=1 to commit.'))
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
