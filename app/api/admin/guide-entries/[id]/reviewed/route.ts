import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, canActInCity, isAdmin } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { writeAudit } from '@/lib/audit'

// "Reviewed today" for a guide entry — the one way its `lastReviewedAt`
// moves. Same rule as the Handbook (app/api/admin/posts/[id]/reviewed): never
// derived from an edit, never a form field. The columns existed on the model
// for months with nothing able to set them, so every entry read as unreviewed
// and the page said nothing about how fresh "₺₺" or "last ferry" was.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const entry = await prisma.guideEntry.findUnique({ where: { id }, select: { title: true, cityId: true, lastReviewedAt: true } })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActInCity(session, entry.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // A review is a claim readers act on: step-up for admins, as with the Handbook.
  if (isAdmin(session)) {
    const gate = requireStepUp(session)
    if (gate) return gate
  }

  const now = new Date()
  // Raw SQL so a review doesn't move updatedAt — a review is not an edit.
  await prisma.$executeRaw`UPDATE "guide_entries" SET "lastReviewedAt" = ${now} WHERE "id" = ${id}`
  writeAudit(session.id, session.name, 'guide_entry.reviewed', id, 'guide_entry',
    { title: entry.title, previous: entry.lastReviewedAt?.toISOString() ?? null },
    `Marked "${entry.title}" as reviewed`,
  )
  revalidateTag('guide')
  return NextResponse.json({ ok: true, lastReviewedAt: now.toISOString() })
}
