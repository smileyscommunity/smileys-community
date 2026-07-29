// One-off: backfill the account.self_delete identity snapshot for Jayrald Mores,
// whose account was self-deleted (2026-07-28 16:54) before the snapshot feature
// existed. Identity taken from his membership application (fullName + email +
// phone); ghost user id matched by being the only deletion that day, right after
// his 16:36 approval. Only this account is confidently identifiable; the other
// pre-feature deletions are not, so they're left without a snapshot.
//   npx tsx --env-file=.env --env-file=.env.local scripts/backfill-jayrald-snapshot.ts
import { prisma } from '../lib/prisma'
import { writeAudit } from '../lib/audit'

const GHOST_ID = 'cms4voeau00dn1l6fnz691znx'

async function main() {
  const existing = await prisma.auditLog.count({ where: { action: 'account.self_delete', targetId: GHOST_ID } })
  if (existing > 0) { console.log('Snapshot already exists — skipping.'); return }

  const ghost = await prisma.user.findUnique({ where: { id: GHOST_ID }, select: { email: true, status: true } })
  if (!ghost || !ghost.email.endsWith('@deleted.smileys')) {
    console.log('Ghost account not found or not a deleted account — aborting.', ghost)
    return
  }

  await writeAudit(
    'cmoofepme0000bj6fkazj835e', 'Smileys Admin',
    'account.self_delete', GHOST_ID, 'user',
    { name: 'Jayrald Mores', email: 'jayraldmores7@gmail.com', phone: '+639055000864', backfilled: true },
    'Backfilled identity snapshot for a pre-feature self-deletion (matched via application + deletion timing)',
  )
  console.log('Backfilled snapshot for Jayrald Mores →', GHOST_ID)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
