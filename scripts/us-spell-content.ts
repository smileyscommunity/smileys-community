// Put the site's OWN written content into US spelling (Nate, 2026-10-02:
// "i am american"). The code and screens were done by a sweep; this is the
// text that lives in the database. It is deliberately narrow:
//
//   posts          title, excerpt, body (HTML — only the text between tags, plus
//                  alt/title attribute values; never hrefs, classes, styles)
//   businesses     description               (the directory copy we wrote)
//   neighborhoods  vibe, area                (registry labels)
//   guide          guide_entries tagline, title
//   sources        posts.officialSources[].label  (jsonb — the label text only; the
//                  url and every other key are carried through unchanged)
//
// NOT touched, on purpose: anything a member wrote (bios, applications,
// messages, event/club/hangout descriptions, reviews, listings), history
// (notifications, audit logs, sent newsletters), slugs and URLs, business
// names (proper nouns), and handbook_sources.text (the weekly watch compares
// it with the live official page — rewriting it would flag every source as
// "changed"). Files on the server (data/content.json, city-guide.json,
// data/neighborhoods/*.json) are a separate pass.
//
// Usage (on the server, per CLAUDE.md conventions):
//   npx tsx --env-file=.env --env-file=.env.local scripts/us-spell-content.ts
//     → DRY RUN (default): prints every change grouped by word, flags capitalised
//       mid-sentence matches (likely proper nouns) with context, writes the full
//       report to /root/us-spelling-report.json. Writes NOTHING to the database.
//   APPLY=1 TARGETS=posts,businesses,neighborhoods,guide EXPECT=<n> npx tsx …
//     → snapshots the old values to /root/db-backups-manual/, then updates. EXPECT
//       is the number of changed cells the dry run reported — a mismatch aborts, so
//       content edited in between is never overwritten blind.
//
// Each UPDATE is guarded on the cell still holding the value that was read
// (idempotent; a concurrent edit is skipped and reported) and is raw SQL so it
// does not move updatedAt (the editor's version check, "last updated" dates).
// EXCEPTIONS (words that must stay as written) go in KEEP below.
//
// NOTE for sweeps: this file and scripts/data/us-spelling-map.json hold the
// British spellings on purpose — exempt them from any spelling sweep.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

const APPLY   = process.env.APPLY === '1'
const TARGETS = (process.env.TARGETS ?? 'posts,businesses,neighborhoods,guide,sources').split(',').map(s => s.trim()).filter(Boolean)
const EXPECT  = process.env.EXPECT ? Number(process.env.EXPECT) : null

// Whole-word proper nouns / official names to leave exactly as written.
const KEEP: RegExp[] = []

interface Target { table: string; label: string; cols: string[]; html?: string[] }
const ALL_TARGETS: Record<string, Target> = {
  posts:         { table: 'posts',         label: 'slug', cols: ['title', 'excerpt', 'body'], html: ['body'] },
  businesses:    { table: 'businesses',    label: 'name', cols: ['description'] },   // no slug column
  neighborhoods: { table: 'neighborhoods', label: 'slug', cols: ['vibe', 'area'] },
  guide:         { table: 'guide_entries', label: 'slug', cols: ['tagline', 'title'] },
}

const BASE: Record<string, string> = JSON.parse(readFileSync(join(process.cwd(), 'scripts/data/us-spelling-map.json'), 'utf8'))
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const WORDS: Record<string, string> = {}
for (const [b, a] of Object.entries(BASE)) { WORDS[b] = a; WORDS[cap(b)] = cap(a); WORDS[b.toUpperCase()] = a.toUpperCase() }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RX = new RegExp(`(?<![\\p{L}\\p{N}_])(${Object.keys(WORDS).sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'gu')

interface Hit { from: string; to: string; context: string; flag: boolean }

/** Replace in plain text, recording each hit. A capitalised match mid-sentence is
 *  flagged: it is probably a proper noun ("Cultural Centre", "Grey Wolves"). */
function replaceText(text: string, hits: Hit[]): string {
  return text.replace(RX, (m, _g, offset: number, whole: string) => {
    if (KEEP.some(k => k.test(whole.slice(Math.max(0, offset - 30), offset + m.length + 30)))) return m
    const before = whole.slice(0, offset).trimEnd()
    const upper = m[0] !== m[0].toLowerCase() && m !== m.toUpperCase()
    const flag = upper && before.length > 0 && !/[.!?:\n]$/.test(before) && !/[.!?:]\s*$/.test(before)
    hits.push({ from: m, to: WORDS[m], flag, context: whole.slice(Math.max(0, offset - 40), offset + m.length + 40).replace(/\s+/g, ' ') })
    return WORDS[m]
  })
}

/** HTML: only text nodes, and the value of alt="" / title="" attributes. */
function replaceHtml(html: string, hits: Hit[]): string {
  return html.split(/(<[^>]*>)/).map((seg, i) => {
    if (i % 2 === 0) return replaceText(seg, hits)
    return seg.replace(/\b(alt|title)="([^"]*)"/g, (_m, attr, val) => `${attr}="${replaceText(val, hits)}"`)
  }).join('')
}

interface Change { target: string; table: string; id: string; label: string; col: string; old: string; next: string; hits: Hit[]; jsonb?: boolean }

async function main() {
  const changes: Change[] = []
  for (const name of TARGETS) {
    if (name === 'sources') {
      // officialSources: [{ label, url, … }]. Only `label` is read as text; the
      // whole array is written back with every other key untouched, guarded on
      // the jsonb still being equal to what was read (jsonb equality ignores key order).
      const rows = await prisma.$queryRawUnsafe<{ id: string; slug: string; src: unknown }[]>(
        `SELECT "id", "slug", "officialSources" AS "src" FROM "posts" WHERE jsonb_typeof("officialSources") = 'array'`)
      for (const r of rows) {
        if (!Array.isArray(r.src)) continue
        const hits: Hit[] = []
        const next = r.src.map(e => (e && typeof e === 'object' && typeof (e as { label?: unknown }).label === 'string')
          ? { ...(e as Record<string, unknown>), label: replaceText((e as { label: string }).label, hits) } : e)
        if (hits.length) changes.push({ target: 'sources', table: 'posts', id: r.id, label: r.slug, col: 'officialSources', old: JSON.stringify(r.src), next: JSON.stringify(next), hits, jsonb: true })
      }
      continue
    }
    const t = ALL_TARGETS[name]
    if (!t) { console.error(`✗ unknown target ${name}`); process.exit(1) }
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "id", "${t.label}" AS "_label", ${t.cols.map(c => `"${c}"`).join(', ')} FROM "${t.table}"`)
    for (const r of rows) for (const col of t.cols) {
      const old = r[col]
      if (typeof old !== 'string' || !old) continue
      const hits: Hit[] = []
      const next = t.html?.includes(col) ? replaceHtml(old, hits) : replaceText(old, hits)
      if (next !== old) changes.push({ target: name, table: t.table, id: String(r.id), label: String(r._label), col, old, next, hits })
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const byWord = new Map<string, number>(), byTarget = new Map<string, { cells: number; rows: Set<string>; hits: number }>()
  for (const c of changes) {
    const bt = byTarget.get(c.target) ?? { cells: 0, rows: new Set<string>(), hits: 0 }
    bt.cells++; bt.rows.add(c.id); bt.hits += c.hits.length; byTarget.set(c.target, bt)
    for (const h of c.hits) byWord.set(`${h.from} → ${h.to}`, (byWord.get(`${h.from} → ${h.to}`) ?? 0) + 1)
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — targets: ${TARGETS.join(', ')}`)
  for (const [n, v] of byTarget) console.log(`  ${n.padEnd(14)} ${String(v.rows.size).padStart(4)} rows · ${String(v.cells).padStart(4)} cells · ${String(v.hits).padStart(5)} replacements`)
  console.log(`  TOTAL changed cells: ${changes.length}  (pass EXPECT=${changes.length} to apply exactly this)`)
  console.log('\nBy word:'); for (const [w, n] of [...byWord].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${w}`)
  const flagged = changes.flatMap(c => c.hits.filter(h => h.flag).map(h => ({ c, h })))
  console.log(`\nCapitalised mid-sentence (probable proper nouns — review these): ${flagged.length}`)
  for (const { c, h } of flagged) console.log(`  [${c.target}:${c.label}.${c.col}] …${h.context}…  (${h.from} → ${h.to})`)
  if (!APPLY) {
    console.log('\nPer row:')
    const per = new Map<string, number>(); for (const c of changes) per.set(`${c.target}:${c.label}`, (per.get(`${c.target}:${c.label}`) ?? 0) + c.hits.length)
    for (const [k, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
    writeFileSync('/root/us-spelling-report.json', JSON.stringify(changes.map(c => ({ target: c.target, label: c.label, col: c.col, hits: c.hits })), null, 1))
    console.log('\nFull report (every hit with context): /root/us-spelling-report.json\nDRY RUN — nothing written.')
    return
  }

  // ── apply ─────────────────────────────────────────────────────────────────
  if (EXPECT === null) { console.error('✗ APPLY needs EXPECT=<changed cells> from a dry run'); process.exit(1) }
  if (EXPECT !== changes.length) { console.error(`✗ dry run saw ${EXPECT} changed cells, there are ${changes.length} now — content moved; re-run the dry run`); process.exit(1) }
  mkdirSync('/root/db-backups-manual', { recursive: true })
  const snap = `/root/db-backups-manual/us-spelling-content-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(snap, JSON.stringify(changes.map(c => ({ table: c.table, id: c.id, col: c.col, old: c.old })), null, 0))
  console.log(`snapshot: ${snap}`)
  let done = 0; const skipped: string[] = []
  for (const c of changes) {
    // table/col come from the fixed ALL_TARGETS map above, never from input
    const cast = c.jsonb ? '::jsonb' : ''
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "${c.table}" SET "${c.col}" = $1${cast} WHERE "id" = $2 AND "${c.col}" = $3${cast}`, c.next, c.id, c.old)
    if (n === 1) done++; else skipped.push(`${c.target}:${c.label}.${c.col}`)
  }
  console.log(`✓ updated ${done} cells; skipped ${skipped.length} (edited since the read)${skipped.length ? ': ' + skipped.join(', ') : ''}`)
  const admin = await prisma.user.findFirst({ where: { name: 'Nate G.', role: { in: ['admin', 'moderator'] } }, select: { id: true, name: true } })
  if (admin) await writeAudit(admin.id, admin.name, 'content.us_spelling', 'bulk', 'post', { cells: done, targets: TARGETS, snapshot: snap, source: 'script' }, `US spelling applied to ${done} content cells (${TARGETS.join(', ')})`)
}

main().then(() => process.exit(0)).catch(e => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1) })
