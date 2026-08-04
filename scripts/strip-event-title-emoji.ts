// One-off: strip the leading emoji from event titles that duplicate the
// emoji field ("💬 Let's Get Social" + emoji 💬 rendered "💬 💬 …" on every
// card). Going forward the create/update APIs do this on write (see
// splitLeadingEmoji in lib/data.ts); this cleans the existing rows.
//
// The stripped emoji only replaces the emoji field when the field still
// holds the generic default 🎉 — a deliberately chosen emoji (even a
// variant like 🧘 next to a 🧘‍♀️ title) is kept.
//
// Usage (on the server, from /root/smileys-community):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/strip-event-title-emoji.ts
//   npx tsx --env-file=.env --env-file=.env.local scripts/strip-event-title-emoji.ts
import { prisma } from '../lib/prisma'

// Inlined copy of splitLeadingEmoji from lib/data.ts — the script must be
// runnable on the server via scp before the code carrying the helper is
// deployed, so it can't import it.
const LEADING_EMOJI = /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})[️‍]*)+/u
function splitLeadingEmoji(raw: string): { emoji: string | null; title: string } {
  const trimmed = raw.trim()
  const match = trimmed.match(LEADING_EMOJI)
  if (!match) return { emoji: null, title: trimmed }
  const rest = trimmed.slice(match[0].length).trim()
  if (!rest) return { emoji: null, title: trimmed }
  return { emoji: match[0], title: rest }
}

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const events = await prisma.event.findMany({
    select: { id: true, title: true, emoji: true, status: true },
  })

  let changed = 0
  for (const e of events) {
    const { emoji, title } = splitLeadingEmoji(e.title)
    if (!emoji || title === e.title) continue

    const newEmoji = e.emoji === '🎉' ? emoji : e.emoji
    changed++
    console.log(`${DRY_RUN ? '[dry] ' : ''}${e.id} (${e.status}): ${JSON.stringify(e.title)} → ${JSON.stringify(title)}` +
      (newEmoji !== e.emoji ? ` · emoji ${e.emoji} → ${newEmoji}` : ` · emoji ${e.emoji} kept`))

    if (!DRY_RUN) {
      // Guarded on current title so a re-run (or a concurrent edit) can't
      // double-apply or clobber newer data.
      await prisma.event.updateMany({
        where: { id: e.id, title: e.title },
        data:  { title, emoji: newEmoji },
      })
    }
  }

  console.log(`\n${changed} of ${events.length} events ${DRY_RUN ? 'would be' : ''} updated${DRY_RUN ? ' (dry run — set DRY_RUN=0 or omit to apply)' : ''}`)
}

main().finally(() => prisma.$disconnect())
