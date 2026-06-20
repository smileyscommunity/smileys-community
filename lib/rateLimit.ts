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

// Loose but safe: accepts plain IPv4, IPv6 (with or without brackets),
// and rejects anything with unexpected characters that could poison a
// rate-limit key or log line (spaces, semicolons, CRLF injections, etc.).
const IP_RE = /^[\w.:[\]]+$/

function normalizeIp(raw: string): string | null {
  const ip = raw.trim().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  return IP_RE.test(ip) && ip.length <= 45 ? ip : null
}

export function getIp(req: Request): string {
  // x-real-ip is set by Nginx from $remote_addr — not spoofable by clients
  const realIp = req.headers.get('x-real-ip')
  if (realIp) {
    const ip = normalizeIp(realIp)
    if (ip) return ip
  }

  // Fallback: last entry in X-Forwarded-For is added by the trusted proxy
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const last = forwarded.split(',').at(-1) ?? ''
    const ip   = normalizeIp(last)
    if (ip) return ip
  }

  return 'unknown'
}
