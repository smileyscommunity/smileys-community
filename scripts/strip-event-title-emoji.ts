// One-off: strip the leading emoji from event titles that duplicate the
// emoji field ("💬 Let's Get Social" + emoji 💬 rendered "💬 💬 …" on every
// card). Going forward the create/update APIs do this on write (see
// splitLeadingEmoji in lib/data.ts); this cleans the existing rows.
//
// The stripped emoji only replaces the emoji field when the field still
// holds the generic default 🎉 — a deliberately chosen emoji (even a
// variant like 🧘 next to a 🧘‍♀️ title) is kept.
//
// Second pass in the same run: a TRAILING emoji that duplicates the emoji
// field ("Let's Get Social 💬" + emoji 💬) doubles at the other end and is
// dropped too. Trailing emoji that differ from the field ("Picnic in Moda
// 🧺" + emoji 🌳) are deliberate decoration and stay.
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

// Trailing twin of the above; only strips when the trailing run equals the
// emoji field, compared with variation selectors (U+FE0F) removed so
// ⛵︎/⛵️/⛵ count as the same emoji.
const TRAILING_EMOJI = /(?:(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})[\uFE0F\u200D]*)+$/u
function stripDupTrailingEmoji(raw: string, emoji: string | null | undefined): string {
  const trimmed = raw.trim()
  if (!emoji) return trimmed
  const match = trimmed.match(TRAILING_EMOJI)
  if (!match) return trimmed
  const norm = (s: string) => s.replace(/\uFE0F/g, '')
  if (norm(match[0]) !== norm(emoji.trim())) return trimmed
  const rest = trimmed.slice(0, trimmed.length - match[0].length).trim()
  return rest || trimmed
}

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const events = await prisma.event.findMany({
    select: { id: true, title: true, emoji: true, status: true },
  })

  let changed = 0
  for (const e of events) {
    const { emoji, title: afterLeading } = splitLeadingEmoji(e.title)
    const newEmoji = emoji && e.emoji === '🎉' ? emoji : e.emoji
    const title    = stripDupTrailingEmoji(afterLeading, newEmoji)
    if (title === e.title) continue

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
