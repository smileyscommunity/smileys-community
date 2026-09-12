import { prisma } from '@/lib/prisma'

// Deleting a user cascades every Report about or by them, their NoShowCards
// and the AdminNotes on them (prisma/schema.prisma onDelete: Cascade). The
// audit trail has no cascade, so the moderation history rides along in the
// removal's audit row — the same place the identity snapshot already lives.
// Compact on purpose: enough to answer "was this person a problem before".
export async function snapshotUserHistory(userId: string) {
  const [reportsAbout, reportsBy, noShowCards, adminNotes] = await Promise.all([
    prisma.report.findMany({
      where:  { reportedId: userId },
      select: { id: true, reporterId: true, reason: true, status: true, details: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, take: 200,
    }),
    prisma.report.findMany({
      where:  { reporterId: userId },
      select: { id: true, reportedId: true, reason: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, take: 200,
    }),
    prisma.noShowCard.findMany({
      where:  { userId },
      select: { id: true, eventId: true, kind: true, status: true, issuedAt: true },
      orderBy: { issuedAt: 'asc' }, take: 200,
    }),
    prisma.adminNote.findMany({
      where:  { userId },
      select: { id: true, text: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, take: 200,
    }),
  ])
  return {
    reportsAbout: reportsAbout.map(r => ({ ...r, details: r.details?.slice(0, 300) ?? null })),
    reportsBy,
    noShowCards,
    adminNotes: adminNotes.map(n => ({ ...n, text: n.text.slice(0, 500) })),
  }
}
