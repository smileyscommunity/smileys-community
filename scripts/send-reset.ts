// Send a fresh password-reset link to one or more members (support action).
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/send-reset.ts <email> [email2 ...]
//
// Self-contained (no '@/' aliases) so it runs cleanly under tsx on the server.
// Mirrors app/api/auth/forgot-password: invalidates old tokens, stores the
// SHA-256 hash, emails the plaintext link (valid 1 hour). Uses RESEND_API_KEY +
// EMAIL_FROM from .env.local and DATABASE_URL from .env.

import { randomBytes, createHash } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Resend } from 'resend'

const emails = process.argv.slice(2).map(e => e.toLowerCase().trim()).filter(Boolean)
if (!emails.length) {
  console.error('Usage: npx tsx --env-file=.env --env-file=.env.local scripts/send-reset.ts <email> [email2 ...]')
  process.exit(1)
}

const SITE    = process.env.NEXT_PUBLIC_SITE_URL || 'https://smileyscommunity.com'
const APP_URL = `${SITE}/app`
const FROM    = process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>'

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])
const resend  = new Resend(process.env.RESEND_API_KEY!)

function emailHtml(name: string, url: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#faf7f2;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px">
    <p style="font-size:24px;margin:0 0 16px">😊 <strong>Smileys Community</strong></p>
    <h1 style="font-size:20px;color:#111;margin:0 0 12px">Reset your password</h1>
    <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 20px">Hi ${name || 'there'}, we received a request to reset your password. Click below to choose a new one — this link is valid for 1 hour.</p>
    <a href="${url}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;text-decoration:none">Reset my password →</a>
    <p style="font-size:12px;color:#999;line-height:1.6;margin:24px 0 0">If you didn't request this, you can safely ignore this email. Or copy this link:<br><span style="color:#777;word-break:break-all">${url}</span></p>
  </div></body></html>`
}

async function main() {
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user)          { console.log(`✗ ${email}: no account`); continue }
    if (!user.password) { console.log(`✗ ${email}: not activated (no password) — send activation instead`); continue }

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })

    const token = randomBytes(32).toString('hex')
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    })

    const url = `${APP_URL}/reset-password?token=${token}`
    await resend.emails.send({ from: FROM, to: user.email, subject: 'Reset your Smileys password', html: emailHtml(user.name, url) })
    console.log(`✓ ${email}: reset link sent`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => { console.error('✗', e); await prisma.$disconnect(); process.exit(1) })
