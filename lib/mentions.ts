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

// Original case is kept: the DB lookup is a case-insensitive match and
// Postgres folds 'İ' itself, whereas JS lowercasing turns 'İrem' into
// 'i̇rem' (i + combining dot), which ILIKE never matches. Hyphens and
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

// Accent- and case-insensitive: 'İrem' / 'irem' / 'IREM' compare equal, and so
// do the straight and curly apostrophe. Dotless ı folds to i as well —
// toLowerCase maps 'I' to 'i', so "IŞIK" and "Işık" would otherwise differ.
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'").toLowerCase().replace(/ı/g, 'i')
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

// Candidates whose name holds the token as a whole word. A bare prefix query
// capped at 50 let fifty Alices crowd out the one Ali the post was for.
function nameHasWord(word: string) {
  return [
    { name: { equals:     word,         mode: 'insensitive' as const } },
    { name: { startsWith: `${word} `,   mode: 'insensitive' as const } },
    { name: { contains:   ` ${word} `,  mode: 'insensitive' as const } },
  ]
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

  const candidates = await prisma.user.findMany({
    where: {
      status: 'approved',
      id:     { not: opts.authorId },
      ...(opts.cityId ? { cityId: opts.cityId } : {}),
      OR:     words.flatMap(mentionForms).flatMap(nameHasWord),
    },
    select: { id: true, name: true },
    take:   50,
  })
  const matched = candidates.filter(u => words.some(w => mentionMatches(u.name, w)))
  if (!matched.length) return 0

  const recipients = (await dropBlocked(opts.authorId, matched)).slice(0, MAX_RECIPIENTS)
  await Promise.allSettled(recipients.map(u =>
    createNotification(u.id, 'neighborhood_mention', `${opts.authorName} mentioned you`, opts.content.slice(0, 120), opts.link)
  ))
  return recipients.length
}
