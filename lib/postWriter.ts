import { prisma } from './prisma'
import { isAdmin } from './access'
import type { SessionUser } from './session'

// Who an article is credited to. By default the account that saves it —
// which is how two of Nate's stories came out as "Smileys Admin" when he
// published from the admin account (2026-09-08). An admin may credit any
// staff member instead; a moderator always writes as themselves.
export const WRITER_ROLES = ['admin', 'moderator'] as const

export type WriterPick =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 403; error: string }

export async function pickWriter(session: SessionUser, requested: unknown): Promise<WriterPick> {
  const wanted = typeof requested === 'string' ? requested.trim() : ''
  if (!wanted || wanted === session.id) return { ok: true, id: session.id }
  if (!isAdmin(session)) return { ok: false, status: 403, error: 'Only an admin can credit another writer' }
  const writer = await prisma.user.findFirst({
    where:  { id: wanted, role: { in: [...WRITER_ROLES] }, status: 'approved' },
    select: { id: true },
  })
  if (!writer) return { ok: false, status: 400, error: 'That writer is not a staff member' }
  return { ok: true, id: writer.id }
}
