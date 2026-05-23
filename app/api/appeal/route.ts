import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`appeal:${getIp(req)}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }

    const { email, note, _hp, _t, _cf } = await req.json()
    if (_hp) return NextResponse.json({ ok: true })
    if (_t && Date.now() - Number(_t) < 3000) return NextResponse.json({ ok: true })
    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }
    if (!email?.trim() || !note?.trim()) {
      return NextResponse.json({ error: 'Email and appeal message are required' }, { status: 400 })
    }
    if (note.trim().length > 2000) {
      return NextResponse.json({ error: 'Appeal message too long (max 2000 chars)' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) {
      // Return generic message to avoid email enumeration
      return NextResponse.json({ ok: true })
    }

    if (user.status !== 'banned' || user.appealStatus === 'pending') {
      return NextResponse.json({ ok: true })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { appealNote: note.trim(), appealStatus: 'pending', appealedAt: new Date() },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
