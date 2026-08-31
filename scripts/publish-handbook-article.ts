// Publish a handbook article from a JSON content file — the parameterized
// version of what İzmir and Antalya each needed a bespoke script for
// (publish-izmirim-kart.ts, publish-antalyakart.ts — kept as history, this
// replaces them going forward).
//
// Usage (on the server, per CLAUDE.md conventions):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/publish-handbook-article.ts scripts/data/<article>.json
//   ...review the plan, then rerun without DRY_RUN=1.
//
// The JSON file (see scripts/data/handbook-article.example.json):
//   { title, slug, excerpt, bodyHtml, category, citySlug (null = global),
//     tags: string[], officialSources: [{ label, url }] }
//
// Every field is validated before the DB is touched; category must resolve
// through lib/handbook-categories' canonicalCategory (aliases accepted, but
// the canonical key is what gets stored — no new legacy rows).
//
// Idempotent: skips if the slug already exists. notifiedAt is set at insert so
// the "new article" broadcast never claims it — a city-local article shouldn't
// ping every other city's members, and a backfilled one shouldn't ping anyone.
// lastReviewedAt stays null on purpose: it renders "not yet reviewed", which
// is honest until someone in that city checks the facts.
import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import { canonicalCategory } from '@/lib/handbook-categories'

const DRY_RUN = process.env.DRY_RUN === '1'

interface ArticleInput {
  title:           string
  slug:            string
  excerpt:         string
  bodyHtml:        string
  category:        string   // stored as its canonical key
  citySlug:        string | null
  tags:            string[]
  officialSources: { label: string; url: string }[]
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function nonEmptyString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(`"${field}" must be a non-empty string`)
  return v.trim()
}

// Validates shape only — content judgement (fares omitted, facts sourced)
// stays with whoever wrote the JSON.
function parseArticle(file: string): ArticleInput {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`could not read/parse ${file}: ${e instanceof Error ? e.message : e}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('content file must be a JSON object')
  const b = raw as Record<string, unknown>

  const title    = nonEmptyString(b.title, 'title')
  const slug     = nonEmptyString(b.slug, 'slug')
  if (!SLUG_RE.test(slug)) fail('"slug" must be lowercase words separated by single hyphens')
  const excerpt  = nonEmptyString(b.excerpt, 'excerpt')
  const bodyHtml = nonEmptyString(b.bodyHtml, 'bodyHtml')

  const category = canonicalCategory(nonEmptyString(b.category, 'category'))
  if (!category) fail(`"category" is not a handbook category or alias (see lib/handbook-categories.ts): ${b.category}`)

  // citySlug must be present explicitly — null means global, and "I forgot the
  // field" must not silently publish an article to every city's handbook.
  if (!('citySlug' in b)) fail('"citySlug" is required — a city slug, or null for global content')
  if (b.citySlug !== null && (typeof b.citySlug !== 'string' || !b.citySlug.trim())) {
    fail('"citySlug" must be a city slug string or null')
  }
  const citySlug = b.citySlug === null ? null : (b.citySlug as string).trim()

  if (!Array.isArray(b.tags) || b.tags.some(t => typeof t !== 'string' || !t.trim())) {
    fail('"tags" must be an array of non-empty strings (may be empty)')
  }
  const tags = (b.tags as string[]).map(t => t.trim())

  if (!Array.isArray(b.officialSources)) fail('"officialSources" must be an array of { label, url }')
  const officialSources = (b.officialSources as unknown[]).map((s, i) => {
    if (typeof s !== 'object' || s === null) fail(`officialSources[${i}] must be an object { label, url }`)
    const src = s as Record<string, unknown>
    const label = nonEmptyString(src.label, `officialSources[${i}].label`)
    const url   = nonEmptyString(src.url, `officialSources[${i}].url`)
    if (!/^https?:\/\//.test(url)) fail(`officialSources[${i}].url must be an http(s) URL: ${url}`)
    return { label, url }
  })

  return { title, slug, excerpt, bodyHtml, category, citySlug, tags, officialSources }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: [DRY_RUN=1] tsx scripts/publish-handbook-article.ts <content-file.json>')
    process.exit(1)
  }

  const article = parseArticle(file)

  const existing = await prisma.post.findUnique({ where: { slug: article.slug }, select: { id: true, status: true } })
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  // Articles carry the owner's byline, not the system account's — display
  // names are member-editable; the role constraint stops byline spoofing.
  const author = await prisma.user.findFirst({ where: { name: 'Nate G.', role: { in: ['admin', 'moderator'] } }, select: { id: true, name: true } })
  if (!author) throw new Error('Author "Nate G." not found')

  let cityId: string | null = null
  let cityName = 'global (every city)'
  if (article.citySlug) {
    const city = await prisma.city.findUnique({ where: { slug: article.citySlug }, select: { id: true, name: true } })
    if (!city) throw new Error(`City not found: ${article.citySlug}`)
    cityId = city.id
    cityName = city.name
  }

  console.log(`→ publish "${article.title}" [${article.category}] as ${author.name}, city ${cityName}`)
  if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }

  const now = new Date()
  const post = await prisma.post.create({
    data: {
      title:       article.title,
      slug:        article.slug,
      excerpt:     article.excerpt,
      body:        article.bodyHtml,
      status:      'published',
      category:    article.category,
      kind:        'handbook',
      authorId:    author.id,
      cityId,
      publishedAt: now,
      notifiedAt:  now,
      tags:        article.tags,
      officialSources: article.officialSources,
      // lastReviewedAt / reviewIntervalDays deliberately unset — see header.
    },
  })
  console.log(`✓ published ${post.slug} (${post.id})`)
}

main().then(() => process.exit(0)).catch(e => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1) })
