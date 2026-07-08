import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const prefs = await prisma.notificationPreference.findUnique({ where: { userId: session.id } })
  return NextResponse.json(prefs ?? {
    newEvents: true, reminders: true, eventUpdates: true,
    joinedEvents: true, wallPosts: true, wallReplies: true, quietHours: false, quietFrom: 23, quietTo: 9,
  })
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const { newEvents, reminders, eventUpdates, joinedEvents, wallPosts, wallReplies, quietHours, quietFrom, quietTo } = body

    // Coerce booleans strictly (an arbitrary truthy value must not slip in),
    // and validate quiet-hours as integers in 0–23 — parseInt used to write
    // NaN into the columns that gate push suppression.
    const bool = (v: unknown) => (v === undefined ? undefined : v === true)
    const hour = (v: unknown) => {
      if (v === undefined) return undefined
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0 || n > 23) return { bad: true } as const
      return n
    }
    const qf = hour(quietFrom)
    const qt = hour(quietTo)
    if ((qf && typeof qf === 'object') || (qt && typeof qt === 'object')) {
      return NextResponse.json({ error: 'quietFrom/quietTo must be integers 0–23' }, { status: 400 })
    }

    const data = {
      ...(bool(newEvents)    !== undefined && { newEvents:    bool(newEvents) }),
      ...(bool(reminders)    !== undefined && { reminders:    bool(reminders) }),
      ...(bool(eventUpdates) !== undefined && { eventUpdates: bool(eventUpdates) }),
      ...(bool(joinedEvents) !== undefined && { joinedEvents: bool(joinedEvents) }),
      ...(bool(wallPosts)    !== undefined && { wallPosts:    bool(wallPosts) }),
      ...(bool(wallReplies)  !== undefined && { wallReplies:  bool(wallReplies) }),
      ...(bool(quietHours)   !== undefined && { quietHours:   bool(quietHours) }),
      ...(qf !== undefined && { quietFrom: qf as number }),
      ...(qt !== undefined && { quietTo:   qt as number }),
    }

    const prefs = await prisma.notificationPreference.upsert({
      where:  { userId: session.id },
      create: { userId: session.id, ...data },
      update: data,
    })
    return NextResponse.json(prefs)
  } catch (e) {
    console.error('[notif prefs PUT]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
