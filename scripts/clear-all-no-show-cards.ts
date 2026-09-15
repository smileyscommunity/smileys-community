// Clear every open no-show card — a deliberate policy reset, not hygiene.
//
// Goes through lib/noShow.waiveCard rather than updating statuses in bulk, for
// two reasons that a bulk UPDATE gets wrong:
//   · a red card can exist ONLY because an earlier yellow counted, so clearing
//     the yellow must downgrade the red with it. waiveCard does that inside the
//     same transaction (downgradeDependentReds); a status flip would leave reds
//     standing on cards that no longer count.
//   · it records waivedBy, waivedAt and a reason, so the audit says who cleared
//     the card and why, months later when someone asks.
//
// It also notifies each member, and these card types are transactional — never
// gated by a preference — so every affected member gets a bell entry and, if
// they have a subscription and are not in quiet hours, a push. That is the
// point: a member whose standing changed should hear about it. Anyone running
// this should know the count first.
//
//   (default)  DRY RUN: list the cards and the members they touch
//   APPLY=1    waive them
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/clear-all-no-show-cards.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/clear-all-no-show-cards.ts
//
// Run on the server: a local .env points at a stale dev copy.
import { prisma } from '@/lib/prisma'
import { waiveCard } from '@/lib/noShow'
import { CardStatus } from '@/lib/noShowPolicy'

const APPLY  = process.env.APPLY === '1'
const REASON = process.env.REASON ?? 'Policy reset — all cards cleared 2026-09-15'
const ACTOR_EMAIL = process.env.ACTOR_EMAIL ?? 'info@smileyscommunity.com'

async function main() {
  console.log(APPLY ? 'APPLY — clearing every open card\n' : 'DRY RUN — nothing is written. APPLY=1 clears.\n')

  const actor = await prisma.user.findFirst({
    where: { email: ACTOR_EMAIL }, select: { id: true, name: true, role: true },
  })
  if (!actor) { console.error(`actor ${ACTOR_EMAIL} not found`); process.exitCode = 1; return }
  console.log(`actor : ${actor.name} (${actor.role})`)
  console.log(`reason: ${REASON}\n`)

  const open = await prisma.noShowCard.findMany({
    where:   { status: { in: [CardStatus.Active, CardStatus.AppealPending] } },
    select:  { id: true, kind: true, status: true, userId: true, occurredAt: true },
    // Newest first. Oldest-first waives a yellow while the red that stood on it
    // is still open, so waiveCard downgrades that red and tells the member
    // "now counts as a warning" — seconds before the next iteration clears it.
    // Reds first means no dependent red is ever open when its yellow goes.
    orderBy: { occurredAt: 'desc' },
  })
  const members = new Set(open.map(c => c.userId))
  console.log(`open cards: ${open.length} (${open.filter(c => c.kind === 'red').length} red,` +
    ` ${open.filter(c => c.kind === 'yellow').length} yellow) across ${members.size} member(s)`)

  if (!APPLY) {
    for (const c of open) {
      console.log(`  ${c.id}  ${c.kind.padEnd(6)} ${c.status.padEnd(15)} member=${c.userId} occurred=${c.occurredAt.toISOString().slice(0, 10)}`)
    }
    console.log('\nDRY RUN — nothing written. Each of these would notify its member.')
    return
  }

  const tally: Record<string, number> = {}
  for (const c of open) {
    // waiveCard refuses anything already closed, so a card another actor
    // resolved between the read and here is skipped, not overwritten.
    const outcome = await waiveCard({ cardId: c.id, actor: { id: actor.id, name: actor.name ?? 'Admin' }, reason: REASON })
    tally[outcome] = (tally[outcome] ?? 0) + 1
  }
  console.log('\noutcomes:')
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(14)} ${v}`)

  const left = await prisma.noShowCard.count({
    where: { status: { in: [CardStatus.Active, CardStatus.AppealPending] } },
  })
  console.log(`\nopen cards remaining: ${left}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
