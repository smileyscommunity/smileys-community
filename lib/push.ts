import webpush from 'web-push'
import { prisma } from './prisma'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string },
) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  if (!subs.length) return

  const data = JSON.stringify(payload)
  const stale: string[] = []

  await Promise.allSettled(
    subs.map(sub =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
        )
        .catch((err: { statusCode?: number }) => {
          // 404/410 means the subscription expired — mark for cleanup
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            stale.push(sub.id)
          }
        }),
    ),
  )

  if (stale.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } })
  }
}
