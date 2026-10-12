import { randomBytes } from 'crypto'
import { prisma } from './prisma'
import { hashToken } from './tokenHash'

// One place that mints an activation link. Approval, the login nudge, the
// expired-link "send me a new one" button and forgot-password all hand a
// never-activated member the same thing: a fresh 7-day token, the old ones
// gone. The plaintext goes into the email; only its hash is stored
// (lib/tokenHash).
export const ACTIVATION_TOKEN_DAYS = 7

export async function issueActivationToken(userId: string, now: Date = new Date()): Promise<string> {
  await prisma.passwordResetToken.deleteMany({ where: { userId } })
  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(now.getTime() + ACTIVATION_TOKEN_DAYS * 24 * 60 * 60 * 1000)
  await prisma.passwordResetToken.create({ data: { userId, token: hashToken(token), expiresAt } })
  return token
}

/** "j***@gmail.com" — enough for "check that inbox", not enough to leak it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}

/**
 * A new 7-day activation token that leaves the member's other live links
 * working, unlike issueActivationToken. For bulk sends: the last-call email
 * must not cancel a WhatsApp link an admin sent the same morning. Only
 * expired tokens are cleared, as the weekly login nudge does.
 */
export async function addActivationToken(userId: string, now: Date = new Date()): Promise<string> {
  await prisma.passwordResetToken.deleteMany({ where: { userId, expiresAt: { lt: now } } })
  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(now.getTime() + ACTIVATION_TOKEN_DAYS * 24 * 60 * 60 * 1000)
  await prisma.passwordResetToken.create({ data: { userId, token: hashToken(token), expiresAt } })
  return token
}
