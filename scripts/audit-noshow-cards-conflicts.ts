// No-show cards against the exemption and conflict-of-interest rules in
// lib/noShowPolicy (noShowExemptionReason, reviewConflict). The 2026-09
// production audit found a moderator's own card activated, and cards from an
// event overturned for two hosts of its club. This lists what exists so the
// product decision (clear them? leave them?) is made on the whole picture.
//
// READ-ONLY. There is no write mode: it prints, and changes nothing.
//
// Every row, never truncated:
//   HELD BY EXEMPT    cards held by someone the rule now exempts — the event's
//                     host, a co-host, an approved host of its club, or a
//                     current admin/moderator — with kind, status and dates.
//   REVIEW CONFLICTS  cards resolved (appeal accepted / rejected, overturned)
//                     by a reviewer who held the card or runs the event; and
//                     cards WAIVED by their own holder. A host waiving someone
//                     else's card from their own event is the designed path
//                     and is not listed.
//
// Caveats: roles and club-host memberships are read as they are NOW, not as
// they were when the card was issued (an event's host and co-hosts are stored
// on the event). Members are printed by id and initials only.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-noshow-cards-conflicts.ts

import { prisma } from '@/lib/prisma'
import { getInitials } from '@/lib/data'
import {
  eventRunners, noShowExemptionReason, reviewConflict,
  type EventRunners, type ExemptionReason, type ReviewConflict,
} from '@/lib/noShowPolicy'

export interface Person { id: string; role: string | null; initials: string }

export interface CardFacts {
  cardId:       string
  kind:         string
  status:       string
  appealStatus: string | null
  occurredAt:   Date
  issuedAt:     Date
  resolvedAt:   Date | null
  waivedAt:     Date | null
  holder:       Person
  eventId:      string
  eventTitle:   string
  eventDate:    string   // 'YYYY-MM-DD'
  runners:      EventRunners
  resolvedBy:   Person | null
  waivedBy:     Person | null
}

export interface ExemptRow   { card: CardFacts; reason: ExemptionReason }
export interface ConflictRow { card: CardFacts; via: 'resolved' | 'waived'; reviewer: Person; conflict: ReviewConflict }

function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1
  return out
}

/** Pure: which cards break the exemption rule, and which were judged by someone with a conflict. */
export function planNoShowConflictAudit(cards: CardFacts[]) {
  const heldByExempt: ExemptRow[] = []
  const reviewConflicts: ConflictRow[] = []
  for (const c of cards) {
    const reason = noShowExemptionReason(c.holder.id, c.holder.role, c.runners)
    if (reason) heldByExempt.push({ card: c, reason })
    if (c.resolvedBy) {
      const conflict = reviewConflict(c.resolvedBy.id, { userId: c.holder.id }, c.runners)
      if (conflict) reviewConflicts.push({ card: c, via: 'resolved', reviewer: c.resolvedBy, conflict })
    }
    if (c.waivedBy && c.waivedBy.id === c.holder.id) {
      reviewConflicts.push({ card: c, via: 'waived', reviewer: c.waivedBy, conflict: 'own_card' })
    }
  }
  return {
    heldByExempt,
    reviewConflicts,
    counts: {
      cards:           cards.length,
      heldByExempt:    heldByExempt.length,
      byReason:        tally(heldByExempt, r => r.reason),
      byStatus:        tally(heldByExempt, r => r.card.status),
      reviewConflicts: reviewConflicts.length,
      byConflict:      tally(reviewConflicts, r => `${r.via}:${r.conflict}`),
      byReviewerRole:  tally(reviewConflicts, r => r.reviewer.role ?? 'unknown'),
    },
  }
}

async function loadCards(): Promise<CardFacts[]> {
  const cards = await prisma.noShowCard.findMany({
    orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, kind: true, status: true, appealStatus: true, occurredAt: true, issuedAt: true,
      resolvedAt: true, resolvedById: true, waivedAt: true, waivedById: true,
      user:  { select: { id: true, name: true, role: true } },
      event: { select: {
        id: true, title: true, date: true, hostId: true,
        cohosts: { select: { userId: true } },
        club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
      } },
    },
  })
  const reviewerIds = [...new Set(cards.flatMap(c => [c.resolvedById, c.waivedById]).filter((x): x is string => !!x))]
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true, role: true } })
    : []
  const person = (u: { id: string; name: string; role: string }): Person => ({ id: u.id, role: u.role, initials: getInitials(u.name) })
  const byId   = new Map(reviewers.map(r => [r.id, person(r)]))
  // A reviewer since deleted outright still shows as an id.
  const ref    = (id: string | null): Person | null => id ? (byId.get(id) ?? { id, role: null, initials: '?' }) : null

  return cards.map(c => ({
    cardId: c.id, kind: c.kind, status: c.status, appealStatus: c.appealStatus,
    occurredAt: c.occurredAt, issuedAt: c.issuedAt, resolvedAt: c.resolvedAt, waivedAt: c.waivedAt,
    holder: person(c.user),
    eventId: c.event.id, eventTitle: c.event.title, eventDate: c.event.date,
    runners: eventRunners(c.event),
    resolvedBy: ref(c.resolvedById),
    waivedBy:   ref(c.waivedById),
  }))
}

const day  = (d: Date | null) => d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'
const who  = (p: Person) => `${p.id} (${p.initials}, ${p.role ?? 'unknown role'})`
const card = (c: CardFacts) =>
  `card=${c.cardId} ${c.kind}/${c.status}${c.appealStatus ? ` appeal=${c.appealStatus}` : ''}` +
  ` event=${c.eventId} ${c.eventDate} "${c.eventTitle}"` +
  ` occurred=${day(c.occurredAt)} issued=${day(c.issuedAt)} resolved=${day(c.resolvedAt)} waived=${day(c.waivedAt)}`

async function main() {
  console.log('READ-ONLY — nothing is written.\n')
  const { heldByExempt, reviewConflicts, counts } = planNoShowConflictAudit(await loadCards())

  console.log(`HELD BY EXEMPT (${heldByExempt.length})`)
  for (const r of heldByExempt) console.log(`  [${r.reason}] holder=${who(r.card.holder)} ${card(r.card)}`)

  console.log(`\nREVIEW CONFLICTS (${reviewConflicts.length})`)
  for (const r of reviewConflicts) {
    console.log(`  [${r.via}:${r.conflict}] reviewer=${who(r.reviewer)} holder=${who(r.card.holder)} ${card(r.card)}`)
  }

  console.log(`\nsummary: cards=${counts.cards} heldByExempt=${counts.heldByExempt} reviewConflicts=${counts.reviewConflicts}`)
  console.log(`held by reason: ${JSON.stringify(counts.byReason)}  by status: ${JSON.stringify(counts.byStatus)}`)
  console.log(`conflicts: ${JSON.stringify(counts.byConflict)}  by reviewer role: ${JSON.stringify(counts.byReviewerRole)}`)
}

// Only run as a CLI — tests import planNoShowConflictAudit.
if (/audit-noshow-cards-conflicts\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
