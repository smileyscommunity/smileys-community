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

export function extractMentions(content: string): string[] {
  const words = [...content.matchAll(/@([\p{L}\p{N}_]{2,})/gu)].map(m => m[1].toLowerCase())
  return [...new Set(words)].slice(0, MAX_MENTIONS)
}

// Case-insensitive whole-first-name match ("@ali" hits "Ali Y.", not "Alice").
export function mentionMatches(name: string, word: string): boolean {
  const first = name.trim().split(/\s+/)[0]?.toLocaleLowerCase('en') ?? ''
  return first === word.toLocaleLowerCase('en')
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
