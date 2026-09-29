// Create a community story (kind 'community') as a DRAFT from a JSON content
// file, for Nate to finish in the admin panel (cover image, then Publish).
// Publishing stays in the panel on purpose: that route busts the cached
// /posts lists and sends the "New from Smileys" bell — a script can do
// neither cleanly (revalidateTag needs the running server).
//
// Usage (on the server, per CLAUDE.md conventions):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/draft-community-post.ts scripts/data/<story>.json
//
// The JSON file: { title, slug, excerpt, bodyHtml, citySlug (null = every city) }
// Idempotent: skips if the slug already exists.
import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

const DRY_RUN = process.env.DRY_RUN === '1'
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function nonEmptyString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(`"${field}" must be a non-empty string`)
  return v.trim()
}

async function main() {
  const file = process.argv[2]
  if (!file) fail('Usage: [DRY_RUN=1] tsx scripts/draft-community-post.ts <content-file.json>')
  const b = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

  const title    = nonEmptyString(b.title, 'title')
  const slug     = nonEmptyString(b.slug, 'slug')
  if (!SLUG_RE.test(slug)) fail('"slug" must be lowercase words separated by single hyphens')
  const excerpt  = nonEmptyString(b.excerpt, 'excerpt')
  const bodyHtml = nonEmptyString(b.bodyHtml, 'bodyHtml')
  // Explicit, as in publish-handbook-article: a forgotten field must not
  // quietly make a one-city story everyone's.
  if (!('citySlug' in b)) fail('"citySlug" is required — a city slug, or null for every city')

  const existing = await prisma.post.findUnique({ where: { slug }, select: { id: true, status: true } })
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  const author = await prisma.user.findFirst({ where: { name: 'Nate G.', role: { in: ['admin', 'moderator'] } }, select: { id: true, name: true } })
  if (!author) throw new Error('Author "Nate G." not found')

  let cityId: string | null = null
  let scope = 'every city'
  if (b.citySlug !== null) {
    const city = await prisma.city.findUnique({ where: { slug: nonEmptyString(b.citySlug, 'citySlug') }, select: { id: true, name: true } })
    if (!city) throw new Error(`City not found: ${b.citySlug}`)
    cityId = city.id
    scope  = `${city.name} only`
  }

  console.log(`→ draft "${title}" [Community] as ${author.name}, scope: ${scope}, /posts/${slug}, body ${bodyHtml.length} chars`)
  if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }

  const post = await prisma.post.create({
    data: {
      title, slug, excerpt,
      body:     bodyHtml,
      status:   'draft',
      kind:     'community',
      category: 'Community',
      authorId: author.id,
      cityId,
    },
  })
  await writeAudit(author.id, author.name, 'post.create', post.id, 'post',
    { title: post.title, status: post.status, category: post.category, slug: post.slug, source: 'script' },
    `Drafted article "${post.title}" (${post.category})`,
  )
  console.log(`✓ drafted ${post.slug} (${post.id}) — add a cover and publish it from the admin panel`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
