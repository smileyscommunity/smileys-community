import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { decryptTotpSecret } from '@/lib/totpCrypto'
import { generateBatch as generateBackupCodes, hashCode as hashBackupCode } from '@/lib/totpBackupCodes'
import { verifySync } from 'otplib/functional'

// GET — return the count of remaining (unused) backup codes for the
// caller. The UI uses this to surface "you have 3 codes left, regenerate"
// in the 2FA settings panel.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpEnabled: true },
  })
  if (!user?.totpEnabled) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
  }

  const remaining = await prisma.totpBackupCode.count({
    where: { userId: session.id, used: false },
  })
  return NextResponse.json({ remaining })
}

// POST — regenerate the batch. Requires a valid current TOTP code so an
// attacker with a stolen session can't issue themselves fresh codes
// without also having the user's phone. Old codes are atomically nuked
// and replaced with a fresh batch of 10.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Same per-user cadence as the rest of the 2FA setup surface.
  if (!await rateLimit(`2fa-backup-regen:${session.id}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'TOTP code is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpSecret: true, totpEnabled: true },
  })
  if (!user?.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
  }

  // Require a fresh TOTP code, not a backup code — otherwise an attacker
  // who's already used one backup code could regenerate the rest.
  const secret = decryptTotpSecret(user.totpSecret)
  const result = verifySync({ token: String(code), secret, strategy: 'totp' } as any)
  if (!(result as any).valid) {
    return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
  }

  const backupCodes = generateBackupCodes()
  await prisma.$transaction([
    prisma.totpBackupCode.deleteMany({ where: { userId: session.id } }),
    prisma.totpBackupCode.createMany({
      data: backupCodes.map(c => ({ userId: session.id, codeHash: hashBackupCode(c) })),
    }),
  ])

  return NextResponse.json({ ok: true, backupCodes })
}
