// Re-publish the TEXT of a handbook article from its JSON content file — the
// counterpart to publish-handbook-article.ts, which creates and deliberately
// refuses to touch a slug that already exists.
//
// This exists for the fact-check pass: the Başkentkart article went live,
// an adversarial check found an age band off by a year (61–64, not 62–64),
// a dead domain readers were being sent to, and a metro line described as
// separate that has run through since 2023. The fixes were made in the file
// the article came from; this carries them to the row.
//
// Usage (on the server, per CLAUDE.md conventions):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/update-handbook-article.ts docs/<article>.json
//   ...review the plan, then rerun without DRY_RUN=1.
//
// What it writes: title, excerpt, body, tags, officialSources — the text.
// What it never writes, on purpose:
//   · status, publishedAt, notifiedAt — a text fix is not a publish event
//   · cityId, country, category      — where an article belongs is a
//                                       decision, made in the panel
//   · lastReviewedAt                 — corrected is not the same as reviewed;
//                                       only a person on the ground sets it
// Caches: the article and index pages revalidate on the 'handbook' tag every
// five minutes, so the fix is live within that window without a deploy.
import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'

const DRY_RUN = process.env.DRY_RUN === '1'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function nonEmptyString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(`"${field}" must be a non-empty string`)
  return v.trim()
}

function readArticle(path: string) {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(path, 'utf8')) }
  catch (e) { fail(`can't read ${path} — ${(e as Error).message}`) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${path} must contain a JSON object`)
  const b = raw as Record<string, unknown>

  const slug     = nonEmptyString(b.slug, 'slug')
  const title    = nonEmptyString(b.title, 'title')
  const excerpt  = nonEmptyString(b.excerpt, 'excerpt')
  const bodyHtml = nonEmptyString(b.bodyHtml, 'bodyHtml')
  if (/<script\b/i.test(bodyHtml)) fail('bodyHtml contains a <script> tag')

  if (!Array.isArray(b.tags) || b.tags.some(t => typeof t !== 'string' || !t.trim())) fail('"tags" must be an array of non-empty strings')
  const tags = (b.tags as string[]).map(t => t.trim())

  if (!Array.isArray(b.officialSources)) fail('"officialSources" must be an array')
  const officialSources = (b.officialSources as unknown[]).map((s, i) => {
    if (!s || typeof s !== 'object') fail(`officialSources[${i}] must be { label, url }`)
    const o = s as Record<string, unknown>
    const label = nonEmptyString(o.label, `officialSources[${i}].label`)
    const url   = nonEmptyString(o.url,   `officialSources[${i}].url`)
    if (!/^https?:\/\//.test(url)) fail(`officialSources[${i}].url must be http(s)`)
    return { label, url }
  })

  return { slug, title, excerpt, bodyHtml, tags, officialSources }
}

// jsonb does not keep object key order — it sorts keys by length, then
// bytewise — so a `sections` block written as { title, items } reads back as
// { items, title }. Plain JSON.stringify would call every entry changed.
function canon(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map(k => [k, sort((x as Record<string, unknown>)[k])]))
    : x
  return JSON.stringify(sort(v ?? null))
}

function same(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b)
}

async function main() {
  const file = process.argv[2]
  if (!file) fail('Usage: [DRY_RUN=1] tsx scripts/update-handbook-article.ts <article.json>')
  const a = readArticle(file)

  const post = await prisma.post.findUnique({
    where:  { slug: a.slug },
    select: { id: true, kind: true, status: true, title: true, excerpt: true, body: true, tags: true, officialSources: true,
              city: { select: { name: true } } },
  })
  if (!post) fail(`no post with slug ${a.slug} — publish-handbook-article.ts creates, this only updates`)
  if (post.kind !== 'handbook') fail(`${a.slug} is a ${post.kind} post, not a handbook article`)

  const diffs: string[] = []
  if (post.title !== a.title)     diffs.push('title')
  if (post.excerpt !== a.excerpt) diffs.push('excerpt')
  if (post.body !== a.bodyHtml)   diffs.push(`body (${post.body.length} → ${a.bodyHtml.length} chars)`)
  if (!same(post.tags, a.tags))   diffs.push('tags')
  if (!same(post.officialSources, a.officialSources)) diffs.push(`officialSources (${Array.isArray(post.officialSources) ? post.officialSources.length : '?'} → ${a.officialSources.length})`)

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}→ "${post.title}" (${post.status}, ${post.city?.name ?? 'no city'})`)
  if (diffs.length === 0) { console.log('  = nothing differs from the file'); return }
  for (const d of diffs) console.log(`  ~ ${d}`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing written'); return }

  await prisma.post.update({
    where: { id: post.id },
    data:  { title: a.title, excerpt: a.excerpt, body: a.bodyHtml, tags: a.tags, officialSources: a.officialSources },
  })
  await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, 'post.update', post.id, 'post',
    { title: a.title, slug: a.slug, changed: diffs, source: 'script', file },
    `Corrected article "${a.title}" from file (${diffs.length} field${diffs.length === 1 ? '' : 's'})`,
  )
  console.log(`\n✓ updated ${a.slug}`)
}

main().then(() => process.exit(0)).catch(e => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1) })
