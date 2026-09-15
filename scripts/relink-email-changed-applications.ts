// Relink approved applications left behind under a member's OLD email address.
//
// Applications have no userId — they are keyed by email. Until 2026-09-15 a
// member who changed their address (self-service or an admin edit) kept their
// application under the old one, so it matched no user and looked like a
// departed member's. That state is what let scrub-orphaned-approved-applications
// erase six live members' applications on 2026-09-14, and it hides the row from
// self-deletion's scrub. Both change paths now move the application; this
// repairs the rows changed before that.
//
// An application is relinked only on strong evidence. Its email must match no
// user row at all (any status), it must be approved and not a scrubbed
// tombstone, and then one of:
//   · name+phone — its fullName AND its phone, both normalised, match the SAME
//     single live account (not banned, not self-deleted) that has no linked
//     application yet;
//   · phone+approval-timing — its phone matches exactly ONE live account, that
//     account has no linked application, no other account matches the name,
//     and the account was created 0–5 minutes after this application's
//     reviewedAt (approval creates the account, so the name was changed since).
// DUPLICATE is never written: the matched account already has an application
// under its current email, so this row is a second application and relinking
// it would give one account two. Two RELINK rows aimed at the same account are
// both demoted to AMBIGUOUS for the same reason. Everything else with a partial
// match is AMBIGUOUS and never written; rows with no candidate are counted.
//
// Normalisation: phone → digits only, last 10 compared, fewer than 9 digits is
// no phone ('+90 555 123 45 67' = '05551234567'). Name → NFKD, combining marks
// stripped, ı/İ → i, lowercased, punctuation and whitespace collapsed
// ('Büşra' = 'busra'). Equal first+last tokens (middle names differ) is a
// weaker signal: enough to call a DUPLICATE with the phone, never to relink.
//
// Output is application ids, user ids and the match basis — never a name,
// email or phone.
//
//   (default)  read-only: list RELINK, DUPLICATE and AMBIGUOUS rows
//   APPLY=1    set each RELINK row's email to the account's current address,
//              guarded on id + the old email seen
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/relink-email-changed-applications.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/relink-email-changed-applications.ts
//
// Run on the server: a local .env points at a stale dev copy.

import { prisma } from '@/lib/prisma'
import { isTombstoneEmail } from '@/lib/applicationScrub'

const APPLY_MODE = process.env.APPLY === '1'

/** Approval creates the account; a joinedAt this soon after reviewedAt is that approval. */
export const APPROVAL_TIMING_WINDOW_MS = 5 * 60 * 1000

export interface RelinkApplication {
  id:         string
  email:      string
  fullName:   string
  phone:      string | null
  reviewedAt: Date | null
}

export interface RelinkUser {
  id:        string
  email:     string
  name:      string
  phone:     string | null
  status:    string
  banReason: string | null
  joinedAt:  Date
  /** An application (any status) already sits under this user's current email. */
  hasLinkedApplication: boolean
}

export type RelinkRow =
  | { id: string; verdict: 'relink'; userId: string; basis: 'name+phone' | 'phone+approval-timing'; seenEmail: string; newEmail: string }
  | { id: string; verdict: 'duplicate'; userId: string; basis: string }
  | { id: string; verdict: 'ambiguous'; basis: string; candidates: string[] }

// Self-deleted accounts are status 'banned' too; banReason is checked on its
// own so a NULL never reads as "not deleted" by accident (the 2026-09-14 trap).
export function isLiveUser(u: Pick<RelinkUser, 'status' | 'banReason' | 'email'>): boolean {
  return u.status !== 'banned' && u.banReason !== 'deleted' && !isTombstoneEmail(u.email)
}

/** Digits only, last 10 compared; under 9 digits is not a phone. */
export function normPhone(s: string | null | undefined): string | null {
  const digits = (s ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-10) : null
}

/** NFKD, marks stripped, ı/İ → i, lowercased, punctuation/whitespace collapsed. */
export function normName(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[ıİ]/g, 'i')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** "first last" of a normalised name with at least two tokens, else null. */
export function firstLastKey(normalised: string): string | null {
  const t = normalised.split(' ').filter(Boolean)
  return t.length >= 2 ? `${t[0]} ${t[t.length - 1]}` : null
}

/** Pure: which applications are a live member's under an old address, which are duplicates, and which are only suspected. */
export function planRelink(input: { apps: RelinkApplication[]; users: RelinkUser[] }) {
  const anyUserEmail = new Set(input.users.map(u => u.email.toLowerCase()))
  // An approved application in this very input under a user's email links it too.
  const appEmails = new Set(input.apps.map(a => a.email.toLowerCase()))
  const hasLinked = (u: RelinkUser) => u.hasLinkedApplication || appEmails.has(u.email.toLowerCase())
  const live = input.users.filter(isLiveUser).map(u => {
    const n = normName(u.name)
    return { u, name: n, firstLast: firstLastKey(n), phone: normPhone(u.phone) }
  })
  const rows: RelinkRow[] = []
  let linked = 0, tombstones = 0, unmatched = 0

  for (const app of input.apps) {
    const e = app.email.toLowerCase()
    if (isTombstoneEmail(e)) { tombstones++; continue }
    if (anyUserEmail.has(e)) { linked++; continue }

    const name = normName(app.fullName)
    const firstLast = firstLastKey(name)
    const phone = normPhone(app.phone)
    const byName  = name ? live.filter(c => c.name === name).map(c => c.u) : []
    // Superset of byName: equal full names have equal first+last tokens.
    const byFirstLast = name ? live.filter(c => c.name === name || (firstLast !== null && c.firstLast === firstLast)).map(c => c.u) : []
    const byPhone = phone ? live.filter(c => c.phone === phone).map(c => c.u) : []
    const both = byName.filter(u => byPhone.includes(u))
    const weakBoth = byFirstLast.filter(u => byPhone.includes(u))
    const ids = (us: RelinkUser[]) => us.map(u => u.id)

    if (both.length === 1) {
      const u = both[0]
      if (hasLinked(u)) rows.push({ id: app.id, verdict: 'duplicate', userId: u.id, basis: 'name+phone' })
      else rows.push({ id: app.id, verdict: 'relink', userId: u.id, basis: 'name+phone', seenEmail: app.email, newEmail: u.email })
      continue
    }
    if (both.length > 1) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: `name+phone match ${both.length} accounts`, candidates: ids(both) })
      continue
    }

    if (byPhone.length === 1 && !hasLinked(byPhone[0]) && app.reviewedAt) {
      const u = byPhone[0]
      const gap = u.joinedAt.getTime() - app.reviewedAt.getTime()
      const nameElsewhere = byFirstLast.some(x => x !== u)
      if (gap >= 0 && gap <= APPROVAL_TIMING_WINDOW_MS && !nameElsewhere) {
        rows.push({ id: app.id, verdict: 'relink', userId: u.id, basis: 'phone+approval-timing', seenEmail: app.email, newEmail: u.email })
        continue
      }
    }

    if (weakBoth.length === 1) {
      const u = weakBoth[0]
      if (hasLinked(u)) rows.push({ id: app.id, verdict: 'duplicate', userId: u.id, basis: 'first+last name+phone' })
      else rows.push({ id: app.id, verdict: 'ambiguous', basis: 'first+last name+phone (middle names differ)', candidates: [u.id] })
      continue
    }
    if (weakBoth.length > 1) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: `first+last name+phone match ${weakBoth.length} accounts`, candidates: ids(weakBoth) })
      continue
    }

    const nameLabel = byName.length ? 'name' : 'first+last name'
    if (byFirstLast.length && byPhone.length) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: `${nameLabel} and phone match different accounts`, candidates: [...new Set(ids([...byFirstLast, ...byPhone]))] })
    } else if (byFirstLast.length) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: `${nameLabel} only (${phone ? 'phone differs' : 'application has no phone'})`, candidates: ids(byFirstLast) })
    } else if (byPhone.length) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: 'phone only (name differs)', candidates: ids(byPhone) })
    } else {
      unmatched++
    }
  }

  // Two applications relinked onto one account would give it two applications.
  const perUser = new Map<string, number>()
  for (const r of rows) if (r.verdict === 'relink') perUser.set(r.userId, (perUser.get(r.userId) ?? 0) + 1)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.verdict === 'relink' && (perUser.get(r.userId) ?? 0) > 1) {
      rows[i] = { id: r.id, verdict: 'ambiguous', basis: `${r.basis}, but ${perUser.get(r.userId)} applications relink to this account`, candidates: [r.userId] }
    }
  }

  return {
    rows,
    counts: {
      applications: input.apps.length,
      relink:       rows.filter(r => r.verdict === 'relink').length,
      duplicate:    rows.filter(r => r.verdict === 'duplicate').length,
      ambiguous:    rows.filter(r => r.verdict === 'ambiguous').length,
      linked, tombstones, unmatched,
    },
  }
}

async function main() {
  console.log(APPLY_MODE
    ? 'APPLY — relinking RELINK rows only\n'
    : 'READ-ONLY — nothing is written. APPLY=1 relinks the RELINK rows.\n')

  const apps = await prisma.memberApplication.findMany({
    where:  { status: 'approved' },
    select: { id: true, email: true, fullName: true, phone: true, reviewedAt: true },
  })
  // Every application address, any status — a user with one is already linked.
  const appEmails = new Set((await prisma.memberApplication.findMany({
    select: { email: true }, distinct: ['email'],
  })).map(a => a.email.toLowerCase()))
  const users = (await prisma.user.findMany({
    select: { id: true, email: true, name: true, phone: true, status: true, banReason: true, joinedAt: true },
  })).map(u => ({ ...u, hasLinkedApplication: appEmails.has(u.email.toLowerCase()) }))
  const { rows, counts } = planRelink({ apps, users })

  // Every row, never truncated. Ids and basis only.
  for (const r of rows) {
    if (r.verdict === 'relink') console.log(`  ${r.id} RELINK    user=${r.userId} basis=${r.basis}`)
    else if (r.verdict === 'duplicate') console.log(`  ${r.id} DUPLICATE user=${r.userId} basis=${r.basis}`)
    else console.log(`  ${r.id} AMBIGUOUS candidates=${r.candidates.join(',')} basis=${r.basis}`)
  }
  console.log(`\nsummary: approvedApplications=${counts.applications} relink=${counts.relink} duplicate=${counts.duplicate} ambiguous=${counts.ambiguous}` +
    ` linked=${counts.linked} tombstones=${counts.tombstones} noCandidate=${counts.unmatched}`)

  if (!APPLY_MODE) { console.log('\nDRY RUN — nothing written.'); return }
  let relinked = 0, skipped = 0
  for (const r of rows) {
    if (r.verdict !== 'relink') continue
    // Guarded on the address we planned from: a row edited since the read is left alone.
    const { count } = await prisma.memberApplication.updateMany({
      where: { id: r.id, email: r.seenEmail },
      data:  { email: r.newEmail },
    })
    if (count) relinked++
    else skipped++
  }
  console.log(`\napplied: relinked=${relinked} skipped=${skipped} (row changed since the read)`)
}

// Only run as a CLI — tests import planRelink.
if (/relink-email-changed-applications\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
