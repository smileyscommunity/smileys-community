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
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { newEvents, reminders, eventUpdates, joinedEvents, wallPosts, wallReplies, quietHours, quietFrom, quietTo } = body

  const data = {
    ...(newEvents    !== undefined && { newEvents }),
    ...(reminders    !== undefined && { reminders }),
    ...(eventUpdates !== undefined && { eventUpdates }),
    ...(joinedEvents !== undefined && { joinedEvents }),
    ...(wallPosts    !== undefined && { wallPosts }),
    ...(wallReplies  !== undefined && { wallReplies }),
    ...(quietHours   !== undefined && { quietHours }),
    ...(quietFrom    !== undefined && { quietFrom: parseInt(quietFrom) }),
    ...(quietTo      !== undefined && { quietTo:   parseInt(quietTo)   }),
  }

  const prefs = await prisma.notificationPreference.upsert({
    where:  { userId: session.id },
    create: { userId: session.id, ...data },
    update: data,
  })
  return NextResponse.json(prefs)
}
