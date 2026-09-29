/**
 * Replace ONLY the `faq` key of the server's data/content.json with a
 * reviewed draft (lib/faqDefault.json). Every other key — hero,
 * stats, footer, whatever an admin set — is written back untouched.
 *
 * The server copy is authoritative (admins edit it live), so this never
 * copies a local content.json anywhere. Guards:
 *   - dry run by default: prints the question-level diff and the sha256 of
 *     the FAQ it would replace;
 *   - COMMIT=1 also needs EXPECT_SHA=<that sha>, so an admin edit made
 *     between the dry run and the commit refuses instead of being clobbered;
 *   - a timestamped backup of the whole file goes to /root/db-backups first;
 *   - the write is tmp + rename, like the admin content route.
 *
 *   npx tsx scripts/apply-faq-content.ts lib/faqDefault.json
 *   COMMIT=1 EXPECT_SHA=… npx tsx scripts/apply-faq-content.ts lib/faqDefault.json
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const FILE       = path.join(process.cwd(), 'data', 'content.json')
const BACKUP_DIR = '/root/db-backups'

type Item    = { q: string; a: string }
type Section = { id: string; icon: string; title: string; items: Item[] }

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function validate(draft: unknown): Section[] {
  if (!Array.isArray(draft) || draft.length === 0) fail('draft must be a non-empty array of sections')
  const ids = new Set<string>()
  const qs  = new Set<string>()
  for (const s of draft as Section[]) {
    for (const k of ['id', 'icon', 'title'] as const) {
      if (typeof s?.[k] !== 'string' || !s[k].trim()) fail(`section is missing ${k}: ${JSON.stringify(s).slice(0, 80)}`)
    }
    if (ids.has(s.id)) fail(`duplicate section id ${s.id}`)
    ids.add(s.id)
    if (!Array.isArray(s.items) || s.items.length === 0) fail(`section ${s.id} has no items`)
    for (const i of s.items) {
      if (typeof i?.q !== 'string' || !i.q.trim() || typeof i?.a !== 'string' || !i.a.trim()) {
        fail(`section ${s.id} has an item without a question or answer`)
      }
      if (qs.has(i.q)) fail(`duplicate question: ${i.q}`)
      qs.add(i.q)
    }
  }
  return draft as Section[]
}

const draftPath = process.argv[2]
if (!draftPath) fail('usage: apply-faq-content.ts <draft.json>')
const next = validate(JSON.parse(fs.readFileSync(draftPath, 'utf8')))

const raw     = fs.readFileSync(FILE, 'utf8')
const content = JSON.parse(raw) as Record<string, unknown>
const current = (content.faq ?? []) as Section[]
const sha     = crypto.createHash('sha256').update(JSON.stringify(current)).digest('hex')

const before = new Map(current.flatMap(s => s.items ?? []).map(i => [i.q, i.a]))
const after  = new Map(next.flatMap(s => s.items).map(i => [i.q, i.a]))
let changed = 0, added = 0, removed = 0
for (const [q, a] of after) {
  if (!before.has(q))          { added++;   console.log(`+ ${q}`) }
  else if (before.get(q) !== a) { changed++; console.log(`~ ${q}`) }
}
for (const q of before.keys()) if (!after.has(q)) { removed++; console.log(`- ${q}`) }
console.log(`\nsections ${current.length} → ${next.length}; questions ${before.size} → ${after.size}`)
console.log(`${changed} changed, ${added} added, ${removed} removed`)
console.log(`current faq sha256: ${sha}`)

if (process.env.COMMIT !== '1') {
  console.log('\nDRY RUN — nothing written. Re-run with COMMIT=1 EXPECT_SHA=<sha above>.')
  process.exit(0)
}
if (process.env.EXPECT_SHA !== sha) fail('EXPECT_SHA does not match the live FAQ — it changed since the dry run; re-run the dry run')

fs.mkdirSync(BACKUP_DIR, { recursive: true })
const backup = path.join(BACKUP_DIR, `content-json-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(backup, raw)
console.log(`backup: ${backup}`)

content.faq = next
const tmp = `${FILE}.tmp-${process.pid}`
fs.writeFileSync(tmp, JSON.stringify(content, null, 2))
fs.renameSync(tmp, FILE)
console.log('✓ faq replaced; every other key unchanged')
