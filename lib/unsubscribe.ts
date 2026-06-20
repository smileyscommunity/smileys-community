import { createHmac, timingSafeEqual } from 'crypto'
import { APP_URL } from '@/lib/env'

const SECRET = process.env.JWT_SECRET

if (!SECRET) throw new Error('JWT_SECRET env var is required')

export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', SECRET!).update(`${userId}:unsub`).digest('hex').slice(0, 32)
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId)
  if (token.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

export function unsubscribeUrl(userId: string, newsletterId?: string): string {
  const base = `${APP_URL}/unsubscribe?uid=${userId}&t=${unsubscribeToken(userId)}`
  return newsletterId ? `${base}&nl=${newsletterId}` : base
}
