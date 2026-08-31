// One-off Handbook content fixes (approved 2026-08-10), in four parts:
//
// 1. Recategorize "Scams & Tourist Traps" → Safety & Emergencies. It was
//    filed under Daily Life; it is the Handbook's most-read article and is
//    safety content by any reading.
// 2. Split the "Daily Life in Istanbul" mega-article:
//    - Healthcare + Pharmacies sections move out into a new canonical
//      "Healthcare in Istanbul" article (populating the Healthcare category).
//    - Banking + Transportation + Taxis sections — which restated the
//      dedicated bank-account and Istanbulkart articles — are replaced by a
//      short pointer block linking to those articles (one information, one
//      home).
// 3. Set officialSources on the articles whose sources were verified today
//    against the live official sites (metro.istanbul fares page, e-İkamet,
//    MHRS, 112.gov.tr, SGK, GİB).
// 4. Set lastReviewedAt ONLY on articles whose volatile facts were actually
//    checked against those sources today. Deliberately NOT stamped:
//    - opening-turkish-bank-account (branch-by-branch policies can't be
//      verified online),
//    - istanbulkart-mastery (fares verified, but the 200 TL card price
//      conflicts with third-party reports of 165 TL and the official site
//      doesn't publish it — needs an on-the-ground check),
//    - family-life (not reviewed).
//
// The new article is created with notifiedAt set, so neither the publish
// notification path nor the backfill script can ever announce it — members
// already saw this content inside Daily Life.
//
// Idempotent: every write is guarded on the current value; a second run
// reports 0 changes. Dry run by default:
//   npx tsx --env-file=.env --env-file=.env.local scripts/handbook-content-fixes-aug2026.ts
// Apply:
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/handbook-content-fixes-aug2026.ts
import { prisma } from '../../lib/prisma'

const APPLY = process.env.APPLY === '1'

const DAILY_LIFE_SLUG = 'daily-life-in-istanbul-the-little-things-that-make-a-big-difference'
const SCAMS_SLUG      = 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid'
const HEALTHCARE_SLUG = 'healthcare-in-istanbul-how-the-system-works'

// Section boundaries in the Daily Life body (as migrated to real <h2>s).
// The splice asserts each marker appears exactly once — if an editor has
// reworked the article since, the script skips rather than mangling it.
const HEALTH_START = '<h2>Healthcare</h2>'
const HEALTH_END   = '<h2>Groceries</h2>'
const BANK_START   = '<h2>Banking</h2>'
const BANK_END     = '<h2>Learning Basic Turkish</h2>'

// Replaces the Banking/Transportation/Taxis sections. Links, not content —
// the two articles it points at are the canonical homes.
const POINTER_BLOCK =
  '<h2>Banking and getting around</h2>' +
  '<p>Both have their own dedicated Handbook guides:</p>' +
  '<ul>' +
  '<li><p><a href="/app/handbook/opening-turkish-bank-account">Opening a Turkish bank account as a foreigner</a> — which banks work for non-residents, what to bring, and what to ask for at the branch.</p></li>' +
  '<li><p><a href="/app/handbook/istanbulkart-mastery">Istanbulkart Mastery</a> — the one card for metro, bus, ferry and Marmaray, including airport routes, fares and transfer discounts.</p></li>' +
  '</ul><p></p>'

// The new Healthcare article. Body is the member-written content extracted
// from Daily Life, restructured under proper headings, plus three verified
// factual additions: MHRS appointments, and 112 as the unified emergency
// number (both checked against the official sites today).
const HEALTHCARE_ARTICLE = {
  slug:    HEALTHCARE_SLUG,
  title:   'Healthcare in Istanbul: How the system works',
  excerpt: 'Public hospitals are cheaper but busier; private hospitals are faster and often English-speaking. Book public appointments through MHRS, find the after-hours duty pharmacy (Nöbetçi Eczane), and call 112 in any emergency.',
  body:
    '<p>Healthcare in Istanbul is excellent and generally affordable. You can choose between public and private providers, and for day-to-day needs the neighbourhood pharmacy handles more than you might expect.</p>' +
    '<h2>Public hospitals</h2>' +
    '<p>Lower cost but often busier.</p>' +
    '<p>Appointments at public hospitals and clinics are booked through <strong>MHRS</strong>, the Ministry of Health’s central appointment system — online, in the app, or by calling 182.</p>' +
    '<h2>Private hospitals</h2>' +
    '<p>Shorter waiting times.</p>' +
    '<p>English-speaking doctors are common at larger private hospitals.</p>' +
    '<p>Many private hospitals work directly with international insurance providers.</p>' +
    '<h2>Pharmacies (Eczane)</h2>' +
    '<p>Pharmacies are everywhere.</p>' +
    '<p>Most are open:</p>' +
    '<ul><li><p>Monday to Saturday</p></li><li><p>During normal business hours</p></li></ul>' +
    '<p>Outside those hours, one pharmacy in each neighbourhood stays open as the <strong>Nöbetçi Eczane</strong> (duty pharmacy).</p>' +
    '<p>Google Maps usually shows the nearest one.</p>' +
    '<h2>Emergencies</h2>' +
    '<p>Call <strong>112</strong> — Türkiye’s single emergency number for ambulance, police and fire.</p>',
}

// Verified against the live official sites on 2026-08-10.
const OFFICIAL_SOURCES: Record<string, { label: string; url: string }[]> = {
  'residence-permit-first-application': [
    { label: 'e-İkamet — official residence permit application system', url: 'https://e-ikamet.goc.gov.tr' },
    { label: 'Directorate of Migration Management (Göç İdaresi)',        url: 'https://www.goc.gov.tr' },
  ],
  'opening-turkish-bank-account': [
    { label: 'Interactive Tax Office (GİB) — tax number applications',   url: 'https://ivd.gib.gov.tr' },
  ],
  'istanbulkart-mastery': [
    { label: 'İstanbulkart — official site',                             url: 'https://www.istanbulkart.istanbul' },
    { label: 'Metro İstanbul — current fare tariffs',                    url: 'https://www.metro.istanbul/seferdurumlari/biletucretleri' },
  ],
  [SCAMS_SLUG]: [
    { label: '112 Emergency Call Centre (Ministry of Interior)',         url: 'https://www.112.gov.tr' },
  ],
  [HEALTHCARE_SLUG]: [
    { label: 'MHRS — central public hospital appointment system',        url: 'https://www.mhrs.gov.tr' },
    { label: 'SGK — Social Security Institution',                        url: 'https://www.sgk.gov.tr' },
  ],
}

// Only articles whose volatile claims were checked against sources today.
const REVIEWED_SLUGS = [
  'residence-permit-first-application',
  SCAMS_SLUG,
  DAILY_LIFE_SLUG,
  HEALTHCARE_SLUG,
]

function spliceOnce(body: string, start: string, end: string, replacement: string):
  { ok: true; body: string } | { ok: false; reason: string } {
  const occurrences = (marker: string) => body.split(marker).length - 1
  if (occurrences(start) !== 1) return { ok: false, reason: `marker "${start}" found ${occurrences(start)}×, expected 1` }
  if (occurrences(end)   !== 1) return { ok: false, reason: `marker "${end}" found ${occurrences(end)}×, expected 1` }
  const s = body.indexOf(start)
  const e = body.indexOf(end)
  if (s >= e) return { ok: false, reason: 'markers out of order' }
  return { ok: true, body: body.slice(0, s) + replacement + body.slice(e) }
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — writing to the database\n' : '🔍 DRY RUN — no writes (set APPLY=1 to commit)\n')
  const now = new Date()

  // ── 1. Scams → Safety & Emergencies ─────────────────────────────────────
  const scams = await prisma.post.findUnique({ where: { slug: SCAMS_SLUG }, select: { id: true, category: true } })
  if (!scams) console.log('✗ scams article not found')
  else if (scams.category === 'Safety & Emergencies') console.log('· scams already in Safety & Emergencies')
  else {
    console.log(`▸ scams: "${scams.category}" → "Safety & Emergencies"`)
    if (APPLY) {
      const r = await prisma.post.updateMany({
        where: { id: scams.id, category: scams.category },
        data:  { category: 'Safety & Emergencies' },
      })
      console.log(r.count === 1 ? '  ✓ recategorized' : '  ⚠️ SKIPPED — changed concurrently')
    }
  }

  // ── 2. Split Daily Life ─────────────────────────────────────────────────
  const daily = await prisma.post.findUnique({
    where: { slug: DAILY_LIFE_SLUG },
    select: { id: true, body: true, excerpt: true, authorId: true },
  })
  if (!daily) { console.log('✗ daily-life article not found'); return }

  const alreadySplit = !daily.body.includes(HEALTH_START) && daily.body.includes('Banking and getting around')
  if (alreadySplit) {
    console.log('· daily-life already split')
  } else {
    // Extract healthcare BEFORE splicing, from the same snapshot.
    const h = spliceOnce(daily.body, HEALTH_START, HEALTH_END, '')
    if (!h.ok) { console.log(`✗ healthcare splice failed: ${h.reason} — no writes for this part`); return }
    const b = spliceOnce(h.body, BANK_START, BANK_END, POINTER_BLOCK)
    if (!b.ok) { console.log(`✗ banking splice failed: ${b.reason} — no writes for this part`); return }
    const newBody    = b.body
    const newExcerpt = (daily.excerpt ?? '').replace('choosing a doctor, ', '')

    console.log(`▸ daily-life: body ${daily.body.length} → ${newBody.length} chars (healthcare out, banking/transport → pointer block)`)
    if (daily.excerpt && newExcerpt !== daily.excerpt) console.log('▸ daily-life: excerpt drops "choosing a doctor"')

    if (APPLY) {
      const r = await prisma.post.updateMany({
        where: { id: daily.id, body: daily.body },   // guard: exact prior body
        data:  { body: newBody, excerpt: newExcerpt || null },
      })
      console.log(r.count === 1 ? '  ✓ daily-life updated' : '  ⚠️ SKIPPED — article changed since read; re-run')
    }
  }

  // New Healthcare article (idempotent on slug).
  const existing = await prisma.post.findUnique({ where: { slug: HEALTHCARE_SLUG }, select: { id: true } })
  if (existing) {
    console.log('· healthcare article already exists')
  } else {
    console.log(`▸ create "${HEALTHCARE_ARTICLE.title}" (Healthcare, published, author = daily-life author, no notification)`)
    if (APPLY) {
      await prisma.post.create({
        data: {
          ...HEALTHCARE_ARTICLE,
          kind:        'handbook',
          category:    'Healthcare',
          status:      'published',
          authorId:    daily.authorId,
          publishedAt: now,
          // Content members already saw inside Daily Life — must never be
          // announced as a new article, by the API or by the backfill script.
          notifiedAt:  now,
        },
      })
      console.log('  ✓ created')
    }
  }

  // ── 3. Official sources ─────────────────────────────────────────────────
  for (const [slug, sources] of Object.entries(OFFICIAL_SOURCES)) {
    const post = await prisma.post.findUnique({ where: { slug }, select: { id: true, officialSources: true } })
    if (!post) { console.log(`✗ ${slug} not found for sources`); continue }
    if (post.officialSources !== null) { console.log(`· ${slug}: sources already set — left untouched`); continue }
    console.log(`▸ ${slug}: +${sources.length} official source${sources.length === 1 ? '' : 's'}`)
    if (APPLY) await prisma.post.update({ where: { id: post.id }, data: { officialSources: sources } })
  }

  // ── 4. Review stamps ────────────────────────────────────────────────────
  for (const slug of REVIEWED_SLUGS) {
    const post = await prisma.post.findUnique({ where: { slug }, select: { id: true, lastReviewedAt: true } })
    if (!post) { console.log(`✗ ${slug} not found for review stamp`); continue }
    if (post.lastReviewedAt !== null) { console.log(`· ${slug}: already has a review date — left untouched`); continue }
    console.log(`▸ ${slug}: lastReviewedAt → ${now.toISOString().slice(0, 10)}`)
    if (APPLY) await prisma.post.updateMany({
      where: { id: post.id, lastReviewedAt: null },
      data:  { lastReviewedAt: now },
    })
  }

  console.log('\nDone.' + (APPLY ? ' Public pages refresh within the 300s handbook cache TTL.' : ' Re-run with APPLY=1 to commit.'))
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
