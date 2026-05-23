import { createHmac } from 'crypto'

const SECRET = process.env.JWT_SECRET ?? 'smileys-fallback'

export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', SECRET).update(`${userId}:unsub`).digest('hex').slice(0, 32)
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  return unsubscribeToken(userId) === token
}

export function unsubscribeUrl(userId: string): string {
  return `https://smileyscommunity.com/app/unsubscribe?uid=${userId}&t=${unsubscribeToken(userId)}`
}
