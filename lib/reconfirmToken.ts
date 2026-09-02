import { createHmac, timingSafeEqual } from 'crypto'
import { APP_URL } from '@/lib/env'

// One-tap "yes, I'm coming" from the reconfirmation email. Same shape as the
// unsubscribe token: an HMAC over the (member, event) pair, no expiry needed
// because the link only ever sets a timestamp on that member's own row for
// that one event — there is nothing to replay into.

const SECRET = process.env.JWT_SECRET
if (!SECRET) throw new Error('JWT_SECRET env var is required')

export function reconfirmToken(userId: string, eventId: string): string {
  return createHmac('sha256', SECRET!).update(`${userId}:${eventId}:reconfirm`).digest('hex').slice(0, 32)
}

export function verifyReconfirmToken(userId: string, eventId: string, token: string): boolean {
  const a = Buffer.from(token)
  const b = Buffer.from(reconfirmToken(userId, eventId))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function reconfirmUrl(userId: string, eventId: string): string {
  return `${APP_URL}/api/events/${eventId}/reconfirm?uid=${encodeURIComponent(userId)}&t=${reconfirmToken(userId, eventId)}`
}
