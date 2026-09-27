import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

// Ban and warn, once. Each existed twice — the users route and the
// moderation queue — and the copies drifted: the queue's ban skipped the
// member notification, its warn left no note on the member's record (so
// report warnings never showed on the member page), and the two used
// different notification types.

type Actor = { id: string; name: string }

/**
 * Everything a ban does besides flipping the status (the caller writes that
 * with its own fields): club counts, blacklist, outstanding links, the
 * member told, the audit row.
 */
export async function afterBan(args: {
  userId:  string
  before:  { status: string | null; email: string | null; phone: string | null; name: string | null }
  reason:  string
  actor:   Actor
  auditMeta?: Record<string, unknown>
}) {
  const { userId, before, reason, actor } = args
  // A banned member isn't counted in their clubs. Guarded so re-banning an
  // already-banned user can't double-decrement.
  if (before.status !== 'banned') {
    const approvedClubs = await prisma.clubMembership.findMany({ where: { userId, status: 'approved' }, select: { clubId: true } })
    if (approvedClubs.length) {
      await prisma.$transaction(approvedClubs.map(m =>
        prisma.club.update({ where: { id: m.clubId }, data: { memberCount: { decrement: 1 } } })))
    }
  }
  // Without the blacklist row a banned member re-applies with a new email.
  if (before.email) {
    await prisma.blacklist.upsert({
      where:  { email: before.email },
      create: { email: before.email, phone: before.phone ?? undefined, name: before.name ?? undefined, reason, bannedBy: actor.name },
      update: {},
    }).catch(err => console.error('[ban] blacklist upsert failed', { userId, err: String(err) }))
  }
  // An activation or reset link still in their inbox must not survive the ban.
  await prisma.passwordResetToken.deleteMany({ where: { userId } })
    .catch(err => console.error('[ban] token cleanup failed', { userId, err: String(err) }))
  createNotification(userId, 'rsvp', 'Your account has been suspended',
    `Your account was suspended: ${reason}. Contact us if you believe this is a mistake.`).catch(() => {})
  writeAudit(actor.id, actor.name, 'user.ban', userId, 'user',
    { reason, name: before.name, ...(args.auditMeta ?? {}) },
    `${before.name ?? userId} banned — ${reason}`)
}

/** A formal warning: counted, noted on the member's record, told, audited. */
export async function warnMember(args: { userId: string; reason: string; actor: Actor; auditMeta?: Record<string, unknown> }) {
  const { userId, reason, actor } = args
  const user = await prisma.user.update({
    where:  { id: userId },
    data:   { warningCount: { increment: 1 } },
    select: { name: true, warningCount: true },
  })
  await prisma.adminNote.create({
    data: { userId, adminId: actor.id, adminName: actor.name, text: `⚠️ Formal Warning #${user.warningCount}: ${reason}` },
  })
  await createNotification(userId, 'warning', 'Official warning ⚠️',
    `You have received a formal warning: ${reason}. Repeated violations may lead to account suspension.`)
  await writeAudit(actor.id, actor.name, 'user.warn', userId, 'user',
    { reason, warningCount: user.warningCount, name: user.name, ...(args.auditMeta ?? {}) },
    `Issued formal warning #${user.warningCount} to ${user.name} — ${reason}`)
  return user
}

/** Fields an unban clears, whichever screen sent it: a stale 'pending'
 *  appeal otherwise swallowed the member's appeal after a later ban. */
export const UNBAN_CLEARS = { banReason: null, bannedAt: null, appealStatus: null, appealNote: null, appealedAt: null } as const
