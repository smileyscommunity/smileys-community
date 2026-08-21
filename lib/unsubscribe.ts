import { createHmac, timingSafeEqual } from 'crypto'
import { APP_URL } from '@/lib/env'

const SECRET = process.env.JWT_SECRET

if (!SECRET) throw new Error('JWT_SECRET env var is required')

export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', SECRET!).update(`${userId}:unsub`).digest('hex').slice(0, 32)
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId)
  // Compare BYTE lengths — timingSafeEqual throws on mismatched buffers,
  // and a multibyte character in attacker-supplied input makes string
  // length and byte length disagree.
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function unsubscribeUrl(userId: string, newsletterId?: string): string {
  const base = `${APP_URL}/unsubscribe?uid=${userId}&t=${unsubscribeToken(userId)}`
  return newsletterId ? `${base}&nl=${newsletterId}` : base
}

// RFC 8058 one-click target for the List-Unsubscribe header: mail providers
// POST here directly (no UI, no session), so it must be the API route, not
// the confirm page the human-visible link points at.
export function oneClickUnsubscribeUrl(userId: string): string {
  return `${APP_URL}/api/unsubscribe?uid=${userId}&t=${unsubscribeToken(userId)}`
}
