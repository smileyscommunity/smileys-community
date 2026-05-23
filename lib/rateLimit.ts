import { prisma } from './prisma'

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const resetAt = new Date(Date.now() + windowMs)

  const result = await prisma.$queryRaw<[{ count: number }]>`
    INSERT INTO rate_limits (key, count, "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT (key) DO UPDATE SET
      count   = CASE WHEN rate_limits."resetAt" < now() THEN 1 ELSE rate_limits.count + 1 END,
      "resetAt" = CASE WHEN rate_limits."resetAt" < now() THEN ${resetAt} ELSE rate_limits."resetAt" END
    RETURNING count
  `

  return Number(result[0].count) <= limit
}

export function getIp(req: Request): string {
  // x-real-ip is set by Nginx from $remote_addr — not spoofable by clients
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  // Fallback: last entry in X-Forwarded-For is added by the trusted proxy
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    return parts[parts.length - 1].trim()
  }

  return 'unknown'
}
