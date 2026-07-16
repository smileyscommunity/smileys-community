import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

// "✋ I'm free too" — one-tap response to an availability pulse. Cheaper
// than composing a DM to a stranger, and it gives the poster the feedback
// the feature was missing (a pulse into the void got zero signal back).
// One wave per member per pulse; waving is one-way (no un-wave — the
// pulse dies within 4h anyway).

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`pulse-wave:${session.id}`, 20, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many waves this hour.' }, { status: 429 })
    }

    const { id } = await params
    const pulse = await prisma.availabilityPulse.findUnique({
      where:  { id },
      select: { id: true, userId: true, until: true, note: true },
    })
    if (!pulse || pulse.until < new Date()) {
      return NextResponse.json({ error: 'Pulse expired' }, { status: 404 })
    }
    if (pulse.userId === session.id) {
      return NextResponse.json({ error: 'That one is yours' }, { status: 400 })
    }

    // Upsert with empty update = idempotent; repeat taps don't re-notify.
    const existing = await prisma.pulseWave.findUnique({
      where: { pulseId_userId: { pulseId: pulse.id, userId: session.id } },
    })
    if (!existing) {
      await prisma.pulseWave.create({ data: { pulseId: pulse.id, userId: session.id } })
      // Deep-link the poster straight into a DM with the waver — the wave
      // is the mutual signal, the message is the plan.
      createNotification(
        pulse.userId,
        'pulse_wave',
        `✋ ${session.name} is free too`,
        'You’re both around right now — send a message and make it happen.',
        `/messages/${session.id}`,
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, waved: true })
  } catch (e) {
    console.error('[pulse wave]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
