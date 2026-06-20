import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

// POST /api/directory/[id]/save — toggle save state for the caller.
// Returns the resulting state so the caller can update their UI without
// re-fetching the list.
//
// Idempotent on the create side (@@unique([userId, businessId]) means
// re-saving is a no-op); the delete side checks first. The toggle
// model — same endpoint, no method overloading — matches Twitter/
// Yelp UX so the UI logic stays simple.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`directory-save:${session.id}`, 60, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many save toggles. Try again in a minute.' }, { status: 429 })
    }

    const { id } = await params
    const business = await prisma.business.findUnique({
      where:  { id },
      select: { id: true, isApproved: true, isActive: true },
    })
    if (!business || !business.isApproved || !business.isActive) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    // Atomic toggle that survives the rapid-double-click race.
    //
    // Previous implementation: findUnique → branch → create/delete.
    // Two concurrent POSTs (double-tap, double-fired pointer events)
    // both saw existing == null, both called create, and the second
    // P2002 surfaced as a 500 that rolled back the optimistic UI.
    //
    // New shape: read once to decide intent, then idempotent
    // deleteMany (for unsave) or create-with-conflict-swallow (for
    // save). Any P2002 from a concurrent racer means "already saved
    // by us, treat as success".
    const existing = await prisma.businessSave.findUnique({
      where:  { userId_businessId: { userId: session.id, businessId: id } },
      select: { id: true },
    })
    if (existing) {
      await prisma.businessSave.deleteMany({
        where: { userId: session.id, businessId: id },
      })
      return NextResponse.json({ saved: false })
    }
    try {
      await prisma.businessSave.create({
        data: { userId: session.id, businessId: id },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        // Concurrent save by the same user landed first — that's
        // exactly the state the caller wants.
        return NextResponse.json({ saved: true })
      }
      throw e
    }
    return NextResponse.json({ saved: true })
  } catch (e) {
    console.error('Directory save POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
