// "Turkey" → "Türkiye" in the readable text of production rows (Nate, 2026-10-14).
//
// Scope (agreed): posts (title, excerpt, body), guide_entries (title, tagline,
// content) and clubs (description). NOT touched: addresses, official-source
// labels (they quote external page titles), event descriptions, and the stored
// nationality values.
//
// Safe by construction:
//  · dry run unless APPLY=1 — prints every changed sentence, before → after
//  · inside HTML only text between tags is edited, never an attribute / href
//  · a token containing '/', '@', '=' or '://' (a URL, "Turkey/Syria") is skipped
//  · "Google Turkey" and "Jewish Museum of Turkey" (proper names) are kept
//  · raw SQL guarded on the value read (compare-and-set) — no @updatedAt bump, so
//    an article doesn't suddenly say "Updated today" and open editors don't 409
//  · APPLY=1 first snapshots every affected row to a JSON file outside the repo
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/turkey-to-turkiye-db.ts        # dry run
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/turkey-to-turkiye-db.ts
import { mkdirSync, writeFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

const KEEP = ['Google Turkey', 'Jewish Museum of Turkey']
const WORD = /\bTurkey\b/g

function fixText(s: string, skipped: string[]): string {
  let t = s
  KEEP.forEach((k, i) => { t = t.split(k).join(`\u0000K${i}\u0000`) })
  t = t.replace(/\S*\bTurkey\b\S*/g, tok => {
    if (/[\/@=]/.test(tok)) { skipped.push(tok); return tok }
    return tok.replace(WORD, 'Türkiye')
  })
  KEEP.forEach((k, i) => { t = t.split(`\u0000K${i}\u0000`).join(k) })
  return t
}

// Text between tags only; attributes (href, src, alt…) are never rewritten.
function fixMaybeHtml(s: string, skipped: string[]): string {
  if (!/<[a-z][^>]*>/i.test(s)) return fixText(s, skipped)
  return s.split(/(<[^>]*>)/).map(part => (part.startsWith('<') ? part : fixText(part, skipped))).join('')
}

function fixJson(v: unknown, skipped: string[]): unknown {
  if (typeof v === 'string') return fixMaybeHtml(v, skipped)
  if (Array.isArray(v)) return v.map(x => fixJson(x, skipped))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fixJson(x, skipped)]))
  return v
}

function show(label: string, before: string, after: string) {
  const parts = before.split(/(?<=[.!?])\s+|\n/)
  const hit = parts.map((p, i) => [p, fixMaybeHtml(p, [])] as const).filter(([a, b]) => a !== b).slice(0, 6)
  console.log(`  ${label}`)
  for (const [a, b] of hit) console.log(`     − ${a.slice(0, 220)}\n     + ${b.slice(0, 220)}`)
  void after
}

async function main() {
  const apply = process.env.APPLY === '1'
  const skipped: string[] = []
  type Change = { table: string; id: string; col: string; before: unknown; after: unknown; json?: boolean }
  const changes: Change[] = []

  const posts = await prisma.post.findMany({ where: { OR: [{ title: { contains: 'Turkey' } }, { excerpt: { contains: 'Turkey' } }, { body: { contains: 'Turkey' } }] }, select: { id: true, slug: true, title: true, excerpt: true, body: true } })
  for (const p of posts) for (const col of ['title', 'excerpt', 'body'] as const) {
    const b = p[col]; if (!b) continue
    const a = col === 'body' ? fixMaybeHtml(b, skipped) : fixText(b, skipped)
    if (a !== b) { changes.push({ table: 'posts', id: p.id, col, before: b, after: a }); console.log(`post ${p.slug}`); show(col, b, a) }
  }

  const guide = await prisma.guideEntry.findMany({ select: { id: true, slug: true, title: true, tagline: true, content: true } })
  for (const g of guide) {
    for (const col of ['title', 'tagline'] as const) {
      const b = g[col]; if (!b.includes('Turkey')) continue
      const a = fixText(b, skipped)
      if (a !== b) { changes.push({ table: 'guide_entries', id: g.id, col, before: b, after: a }); console.log(`guide ${g.slug}`); show(col, b, a) }
    }
    const raw = JSON.stringify(g.content)
    if (raw.includes('Turkey')) {
      const a = fixJson(g.content, skipped)
      if (JSON.stringify(a) !== raw) {
        changes.push({ table: 'guide_entries', id: g.id, col: 'content', before: g.content, after: a, json: true })
        console.log(`guide ${g.slug} (content)`)
        const walk = (x: unknown, y: unknown, path: string) => {
          if (typeof x === 'string' && typeof y === 'string' && x !== y) show(path, x, y)
          else if (x && typeof x === 'object' && y && typeof y === 'object') for (const k of Object.keys(x as object)) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`)
        }
        walk(g.content, a, 'content')
      }
    }
  }

  const clubs = await prisma.club.findMany({ where: { description: { contains: 'Turkey' } }, select: { id: true, slug: true, description: true } })
  for (const c of clubs) {
    const a = fixText(c.description ?? '', skipped)
    if (a !== c.description) { changes.push({ table: 'clubs', id: c.id, col: 'description', before: c.description, after: a }); console.log(`club ${c.slug}`); show('description', c.description ?? '', a) }
  }

  console.log(`\n${changes.length} field(s) to change across ${new Set(changes.map(c => c.table + c.id)).size} row(s).`)
  if (skipped.length) console.log(`Skipped (URL-like tokens kept as-is): ${[...new Set(skipped)].join('  ')}`)
  if (!apply) return console.log('DRY RUN — nothing written. APPLY=1 to write.')

  const dir = '/root/db-backups-manual'
  mkdirSync(dir, { recursive: true })
  const file = `${dir}/turkey-rename-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(changes.map(c => ({ table: c.table, id: c.id, col: c.col, before: c.before })), null, 1))
  console.log(`snapshot → ${file}`)

  let written = 0
  for (const c of changes) {
    let n = 0
    if (c.table === 'posts' && c.col === 'title')       n = await prisma.$executeRaw`UPDATE "posts" SET "title" = ${c.after as string} WHERE id = ${c.id} AND "title" = ${c.before as string}`
    else if (c.table === 'posts' && c.col === 'excerpt') n = await prisma.$executeRaw`UPDATE "posts" SET "excerpt" = ${c.after as string} WHERE id = ${c.id} AND "excerpt" = ${c.before as string}`
    else if (c.table === 'posts' && c.col === 'body')    n = await prisma.$executeRaw`UPDATE "posts" SET "body" = ${c.after as string} WHERE id = ${c.id} AND "body" = ${c.before as string}`
    else if (c.table === 'guide_entries' && c.col === 'title')   n = await prisma.$executeRaw`UPDATE "guide_entries" SET "title" = ${c.after as string} WHERE id = ${c.id} AND "title" = ${c.before as string}`
    else if (c.table === 'guide_entries' && c.col === 'tagline') n = await prisma.$executeRaw`UPDATE "guide_entries" SET "tagline" = ${c.after as string} WHERE id = ${c.id} AND "tagline" = ${c.before as string}`
    else if (c.table === 'guide_entries' && c.col === 'content') n = await prisma.$executeRaw`UPDATE "guide_entries" SET "content" = ${JSON.stringify(c.after)}::jsonb WHERE id = ${c.id} AND "content" = ${JSON.stringify(c.before)}::jsonb`
    else if (c.table === 'clubs')                        n = await prisma.$executeRaw`UPDATE "clubs" SET "description" = ${c.after as string} WHERE id = ${c.id} AND "description" = ${c.before as string}`
    written += n
    if (n !== 1) console.log(`  ! ${c.table} ${c.id} ${c.col}: changed since read — skipped`)
  }
  console.log(`written ${written}/${changes.length}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
