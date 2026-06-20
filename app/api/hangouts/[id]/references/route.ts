import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'

// Hangout references — the trust signal that makes spontaneous meetups
// safe to scale past close friends. See HangoutReference model in
// prisma/schema.prisma for the data shape and counter semantics.
//
// Authorization:
//   Only participants of the hangout (host + anyone who joined) can read or
//   write references for it. The fromUser is always the caller; the toUser
//   must also be a participant. No self-references.
//
// Lifecycle:
//   References are only writeable once the hangout has actually happened
//   (endsAt < now). A 30-day window after that bounds the writes so we
//   don't get late-revisionist references. Reading is always allowed for
//   participants.

const VALID_VIBES = ['good', 'meh', 'no_show'] as const
type Vibe = typeof VALID_VIBES[number]

const WRITE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000  // 30 days post-end

// Compute how the counters should move when a reference is created or
// changed. Returns the delta to apply to toUser's (goodHangouts, noShowCount).
function counterDelta(oldVibe: Vibe | null, newVibe: Vibe): { good: number; noShow: number } {
  const oldGood   = oldVibe === 'good'    ? 1 : 0
  const oldNoShow = oldVibe === 'no_show' ? 1 : 0
  const newGood   = newVibe === 'good'    ? 1 : 0
  const newNoShow = newVibe === 'no_show' ? 1 : 0
  return { good: newGood - oldGood, noShow: newNoShow - oldNoShow }
}

async function loadParticipantContext(hangoutId: string, callerId: string) {
  const hangout = await prisma.hangout.findUnique({
    where: { id: hangoutId },
    select: {
      id: true, userId: true, endsAt: true, status: true,
      joins: { select: { userId: true } },
    },
  })
  if (!hangout) return { error: 'not_found' as const }

  const participantIds = new Set<string>([hangout.userId, ...hangout.joins.map(j => j.userId)])
  if (!participantIds.has(callerId)) return { error: 'forbidden' as const }

  return { hangout, participantIds }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const ctx = await loadParticipantContext(id, session.id)
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error === 'not_found' ? 'Not found' : 'Forbidden' },
      { status: ctx.error === 'not_found' ? 404 : 403 },
    )
  }

  const refs = await prisma.hangoutReference.findMany({
    where: { hangoutId: id },
    select: { id: true, fromUserId: true, toUserId: true, vibe: true, createdAt: true },
  })

  // Shape so the client can render the recap UI: who is still waiting on a
  // reference from me, who already gave/received one.
  const mine = refs.filter(r => r.fromUserId === session.id)
  const mineByTarget: Record<string, Vibe> = {}
  for (const r of mine) mineByTarget[r.toUserId] = r.vibe as Vibe

  return NextResponse.json({
    references: refs,
    myReferences: mineByTarget,
    participants: [...ctx.participantIds].filter(uid => uid !== session.id),
    canWrite: ctx.hangout.endsAt < new Date()
              && Date.now() - ctx.hangout.endsAt.getTime() < WRITE_WINDOW_MS,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body   = await req.json().catch(() => null) as { toUserId?: string; vibe?: string } | null
  if (!body?.toUserId || !VALID_VIBES.includes(body.vibe as Vibe)) {
    return NextResponse.json({ error: 'toUserId and valid vibe required' }, { status: 400 })
  }
  if (body.toUserId === session.id) {
    return NextResponse.json({ error: 'Cannot reference yourself' }, { status: 400 })
  }

  const ctx = await loadParticipantContext(id, session.id)
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error === 'not_found' ? 'Not found' : 'Forbidden' },
      { status: ctx.error === 'not_found' ? 404 : 403 },
    )
  }
  if (!ctx.participantIds.has(body.toUserId)) {
    return NextResponse.json({ error: 'Target was not a participant' }, { status: 400 })
  }

  // Write window: hangout must have ended, and we're within 30 days of it.
  // Don't gate on status === 'expired' because the sweeper might not have
  // run yet when a user lands on the recap page from the push.
  const now = new Date()
  if (ctx.hangout.endsAt >= now) {
    return NextResponse.json({ error: 'Hangout has not ended yet' }, { status: 400 })
  }
  if (now.getTime() - ctx.hangout.endsAt.getTime() > WRITE_WINDOW_MS) {
    return NextResponse.json({ error: 'Reference window has closed' }, { status: 400 })
  }

  const newVibe = body.vibe as Vibe

  try {
    // One transaction: upsert the reference + adjust toUser's counters by
    // whatever delta the vibe change implies. Locks ensure we don't double-
    // count if two clicks race.
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.hangoutReference.findUnique({
        where: { hangoutId_fromUserId_toUserId: {
          hangoutId: id, fromUserId: session.id, toUserId: body.toUserId!,
        } },
      })

      const delta = counterDelta(existing ? (existing.vibe as Vibe) : null, newVibe)

      const ref = existing
        ? await tx.hangoutReference.update({
            where: { id: existing.id },
            data:  { vibe: newVibe },
          })
        : await tx.hangoutReference.create({
            data: {
              hangoutId:  id,
              fromUserId: session.id,
              toUserId:   body.toUserId!,
              vibe:       newVibe,
            },
          })

      if (delta.good !== 0 || delta.noShow !== 0) {
        await tx.user.update({
          where: { id: body.toUserId! },
          data: {
            goodHangouts: { increment: delta.good },
            noShowCount:  { increment: delta.noShow },
          },
        })
      }

      return ref
    })

    // Notify the recipient when they receive a good reference — it's the
    // primary trust signal and people love seeing it.
    if (newVibe === 'good') {
      const hangout = await prisma.hangout.findUnique({
        where:  { id },
        select: { title: true },
      })
      createNotification(
        body.toUserId!,
        'good_reference',
        `⭐ ${session.name} left you a good reference`,
        hangout ? `for "${hangout.title}"` : 'Check your profile to see it.',
        `/members/${body.toUserId}`,
      ).catch(() => {})
    }

    return NextResponse.json({ id: result.id, vibe: result.vibe }, { status: 200 })
  } catch (e) {
    console.error('[hangouts references POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
