import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { sendPushToUser } from '@/lib/push'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const count = await prisma.pushSubscription.count({ where: { userId: session.id } })
  if (count === 0) {
    return NextResponse.json({ error: 'No push subscriptions found for your account. Enable notifications in the app first.' }, { status: 404 })
  }

  await sendPushToUser(session.id, {
    title: 'Smileys push works! 🎉',
    body:  'Notifications are live on this device.',
    link:  '/app/dashboard',
  })

  return NextResponse.json({ ok: true, sentTo: count + ' device(s)' })
}
