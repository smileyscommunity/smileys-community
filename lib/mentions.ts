import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'

// @mentions on the neighborhood wall. The composer inserts `@FirstName `
// (MentionTextarea), so a mention is a first name — never an arbitrary
// prefix. The old resolver ran `name startsWith word` across the whole
// membership with no city, no cap and no block check: "@a @e @m" reached
// nearly every member, and neighborhood_mention is transactional so it
// pushed through quiet hours.
export const MAX_MENTIONS   = 5
export const MAX_RECIPIENTS = 10

// Original case is kept: the DB lookup is a case-insensitive prefix match
// and Postgres folds 'İ' itself, whereas JS lowercasing turns 'İrem' into
// 'i̇rem' (i + combining dot), which ILIKE never matches. Hyphens and
// apostrophes inside a name are part of it (Jean-Luc, O'Brien) — the
// composer inserts the whole first name, so the extractor must keep it.
export function extractMentions(content: string): string[] {
  const words = [...content.matchAll(/@(\p{L}[\p{L}\p{N}_]*(?:[-'’][\p{L}\p{N}_]+)*)/gu)]
    .map(m => m[1]).filter(w => w.length >= 2)
  const seen = new Set<string>()
  return words.filter(w => { const k = foldName(w); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, MAX_MENTIONS)
}

// Accent- and case-insensitive: 'İrem' / 'irem' / 'IREM' compare equal, and so
// do the straight and curly apostrophe.
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'").toLowerCase()
}

// Whole-first-name match ("@ali" hits "Ali Y.", not "Alice"; "@jean-luc" hits "Jean-Luc").
export function mentionMatches(name: string, word: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return foldName(first) === foldName(word)
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
      OR:     words.map(word => ({ name: { startsWith: word, mode: 'insensitive' as const } })),
    },
    select: { id: true, name: true },
    take:   50,
  })
  const matched = candidates.filter(u => words.some(w => mentionMatches(u.name, w)))
  if (!matched.length) return 0

  const blocks = await prisma.memberBlock.findMany({
    where: { OR: [
      { blockerId: opts.authorId, blockedId: { in: matched.map(u => u.id) } },
      { blockedId: opts.authorId, blockerId: { in: matched.map(u => u.id) } },
    ] },
    select: { blockerId: true, blockedId: true },
  })
  const blocked = new Set(blocks.flatMap(b => [b.blockerId, b.blockedId]))

  const recipients = matched.filter(u => !blocked.has(u.id)).slice(0, MAX_RECIPIENTS)
  await Promise.allSettled(recipients.map(u =>
    createNotification(u.id, 'neighborhood_mention', `${opts.authorName} mentioned you`, opts.content.slice(0, 120), opts.link)
  ))
  return recipients.length
}
