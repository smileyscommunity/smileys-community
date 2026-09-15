import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'
import { MENTION_NAME } from '@/lib/mentionToken'

// @mentions on the neighborhood wall. The composer inserts `@FirstName `
// (MentionTextarea), so a mention is a first name — never an arbitrary
// prefix. The old resolver ran `name startsWith word` across the whole
// membership with no city, no cap and no block check: "@a @e @m" reached
// nearly every member, and neighborhood_mention is transactional so it
// pushed through quiet hours.
export const MAX_MENTIONS   = 5
export const MAX_RECIPIENTS = 10

const MENTION_RE = new RegExp(`@(${MENTION_NAME})`, 'gu')

// Original case is kept (it is the spelling the ILIKE fallback asks for);
// the dedupe key is foldName, never bare JS lowercasing. Hyphens and
// apostrophes inside a name are part of it (Jean-Luc, O'Brien) — the
// composer inserts the whole first name, so the extractor must keep it.
// NFC first: stored names are composed, so a decomposed "Çağla" typed on
// another keyboard would otherwise never equal the row.
export function extractMentions(content: string): string[] {
  const words = [...content.normalize('NFC').matchAll(MENTION_RE)]
    .map(m => m[1]).filter(w => w.length >= 2)
  const seen = new Set<string>()
  return words.filter(w => { const k = foldName(w); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, MAX_MENTIONS)
}

// One fold map drives both sides: foldName in JS and the SQL prefilter's
// translate(), so a name the query loads is a name foldName can equal (and
// the reverse). The DB has no unaccent extension and must not grow one.
// Keys are lower-case; upper-case twins are derived below. Dotless ı and
// capital İ fold to i — toLowerCase alone turns 'İrem' into 'i̇rem'.
const FOLD_GROUPS: Record<string, string> = {
  a: 'áàâäãåāăą', c: 'çćčĉċ', d: 'ďđð', e: 'éèêëēėęěĕ', g: 'ğĝġģ', h: 'ĥħ',
  i: 'íìîïīįıĩİ', j: 'ĵ', k: 'ķ', l: 'łľĺļŀ', n: 'ñńňņ', o: 'óòôöõøōőŏ',
  r: 'ŕřŗ', s: 'śšşșŝ', t: 'ťțţ', u: 'úùûüūůűũŭų', y: 'ýÿŷ', z: 'žźż', "'": '’',
}
// translate() maps one character to one, so these go through replace().
export const FOLD_MULTI: ReadonlyArray<readonly [string, string]> = [
  ['æ', 'ae'], ['Æ', 'ae'], ['œ', 'oe'], ['Œ', 'oe'], ['ß', 'ss'], ['ẞ', 'ss'],
]

function buildFold() {
  const map = new Map<string, string>()
  for (const [to, from] of Object.entries(FOLD_GROUPS)) {
    for (const ch of Array.from(from)) {
      const up = ch.toUpperCase()
      // ASCII stays out ('ı' upper-cases to 'I'): lower() already folds it.
      for (const c of [ch, up]) if (Array.from(c).length === 1 && /[^\x00-\x7f]/.test(c) && !map.has(c)) map.set(c, to)
    }
  }
  return map
}
const FOLD_SINGLE = buildFold()
// translate(name, FOLD_FROM, FOLD_TO): the same length, character for character.
export const FOLD_FROM = [...FOLD_SINGLE.keys()].join('')
export const FOLD_TO   = [...FOLD_SINGLE.values()].join('')
const FOLD_ALL = new Map<string, string>([...FOLD_SINGLE, ...FOLD_MULTI])

// Accent- and case-insensitive: 'İrem' / 'irem' / 'IREM' compare equal, and so
// do the straight and curly apostrophe. The map first (what SQL can mirror),
// then any combining mark left over — a typed "@Nguyễn" still folds here even
// though only its exact spelling reaches the query.
const foldByMap = (s: string) => Array.from(s.normalize('NFC'), c => FOLD_ALL.get(c) ?? c).join('')
export function foldName(s: string): string {
  return foldByMap(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// A token and, when it carries an apostrophe suffix, its base: Turkish joins
// case endings to a name with one ("@Ayşe'ye", "@Çağla'nın"). Both are whole
// names — never a prefix.
export function mentionForms(word: string): string[] {
  const base = word.split(/['’]/)[0]
  return base !== word && base.length >= 2 ? [word, base] : [word]
}

// Whole-first-name match ("@ali" hits "Ali Y.", not "Alice"; "@jean-luc" hits "Jean-Luc").
// The name the composer inserted is firstNameOf's given name ("H. Kübra
// Çulha" → Kübra), so that counts alongside the raw first word.
export function mentionMatches(name: string, word: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? ''
  const given = firstNameOf(name).split(/\s+/).pop() ?? ''
  const names = new Set([first, given].filter(Boolean).map(foldName))
  return mentionForms(word).some(f => names.has(foldName(f)))
}

// lower(name) folded by the map above, as SQL. The map travels as bound
// parameters, so there is one copy of it and nothing is spliced into the text.
// Translate runs before lower(): 'İ' and upper-case accents fold the same
// whatever the database's ctype does with them.
const FOLDED_NAME = Prisma.sql`lower(${FOLD_MULTI.reduce(
  (expr, [from, to]) => Prisma.sql`replace(${expr}, ${from}, ${to})`,
  Prisma.sql`translate(name, ${FOLD_FROM}, ${FOLD_TO})`,
)})`

const likeEscape = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

// A name holding the token as a whole word: the whole name, its first word, a
// middle word ("H. Kübra Çulha") or its last ("Dr. Ali"). A bare prefix capped
// at 50 let fifty Alices crowd out the one Ali the post was for.
function wholeWordPatterns(token: string): string[] {
  const w = likeEscape(token)
  return [w, `${w} %`, `% ${w} %`, `% ${w}`]
}

// Patterns for the folded name, plus the token as typed for ILIKE when it
// keeps a letter the map doesn't cover ("@Nguyễn" still finds Nguyễn). Four
// patterns per spelling per form: bounded by MAX_MENTIONS, not by name length.
export function mentionPatterns(words: string[]): { folded: string[]; raw: string[] } {
  const forms = words.flatMap(mentionForms)
  const uniq = (xs: string[]) => [...new Set(xs)]
  return {
    folded: uniq(forms.flatMap(f => wholeWordPatterns(foldName(f)))),
    raw:    uniq(forms.filter(f => /[^\x00-\x7f]/.test(foldByMap(f))).flatMap(wholeWordPatterns)),
  }
}

// The candidate query. Same scope as the Prisma version it replaced: approved
// (so not banned or deleted), not admin-hidden (they are out of mention
// autocomplete too), not the author, the post's city; 50 rows.
export function mentionCandidatesSql(opts: { words: string[]; authorId: string; cityId: string | null }) {
  const { folded, raw } = mentionPatterns(opts.words)
  return Prisma.sql`
    SELECT id, name FROM users
    WHERE status = 'approved' AND "hiddenFromMembers" = false AND id <> ${opts.authorId}
      ${opts.cityId ? Prisma.sql`AND "cityId" = ${opts.cityId}` : Prisma.empty}
      AND (${FOLDED_NAME} LIKE ANY (ARRAY[${Prisma.join(folded)}]::text[])
        ${raw.length ? Prisma.sql`OR name ILIKE ANY (ARRAY[${Prisma.join(raw)}]::text[])` : Prisma.empty})
    LIMIT 50`
}

// Members on either side of a block with the author never get the ping.
export async function dropBlocked<T extends { id: string }>(authorId: string, users: T[]): Promise<T[]> {
  if (!users.length) return users
  const blocks = await prisma.memberBlock.findMany({
    where: { OR: [
      { blockerId: authorId, blockedId: { in: users.map(u => u.id) } },
      { blockedId: authorId, blockerId: { in: users.map(u => u.id) } },
    ] },
    select: { blockerId: true, blockedId: true },
  })
  const blocked = new Set(blocks.flatMap(b => [b.blockerId, b.blockedId]))
  return users.filter(u => !blocked.has(u.id))
}

export async function notifyMentions(opts: {
  content:  string
  authorId: string
  authorName: string
  cityId:   string | null
  link:     string
}): Promise<number> {
  const words = extractMentions(opts.content)
  if (!words.length) return 0

  const candidates = await prisma.$queryRaw<{ id: string; name: string }[]>(
    mentionCandidatesSql({ words, authorId: opts.authorId, cityId: opts.cityId }),
  )
  const matched = candidates.filter(u => words.some(w => mentionMatches(u.name, w)))
  if (!matched.length) return 0

  const recipients = (await dropBlocked(opts.authorId, matched)).slice(0, MAX_RECIPIENTS)
  await Promise.allSettled(recipients.map(u =>
    createNotification(u.id, 'neighborhood_mention', `${opts.authorName} mentioned you`, opts.content.slice(0, 120), opts.link)
  ))
  return recipients.length
}
