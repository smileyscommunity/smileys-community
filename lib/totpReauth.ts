import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptTotpSecret } from '@/lib/totpCrypto'
import { verifySync } from 'otplib/functional'

/**
 * A second proof, for the operations that can take an account away from its
 * owner: changing the login email, changing the password, deleting the
 * account. An enrolled member must present a fresh 6-digit code as well as
 * their password — otherwise a stolen session plus a reused password is
 * enough, and deleting the account (irreversible) used to ask for less than
 * changing the email did.
 *
 * Returns null when the account has no 2FA or the code is good, and the
 * response to send otherwise. 'code_required' is a machine-readable marker:
 * the settings forms reveal their code input on seeing it, rather than
 * showing one to everybody.
 *
 * Call it AFTER the request's other checks: a valid code is claimed for its
 * 30-second step (a code seen at login must not also delete the account), so
 * spending it on a request that then fails for another reason makes the
 * member wait for the next one.
 */
export async function totpReauth(
  user: { id: string; totpEnabled: boolean; totpSecret: string | null },
  code: unknown,
): Promise<NextResponse | null> {
  if (!user.totpEnabled || !user.totpSecret) return null

  const codeStr = String(code ?? '').trim()
  if (!/^\d{6}$/.test(codeStr)) {
    return NextResponse.json({ error: 'code_required' }, { status: 400 })
  }
  const secret = decryptTotpSecret(user.totpSecret)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = verifySync({ token: codeStr, secret, strategy: 'totp' } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(result as any).valid) {
    return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
  }
  // Same atomic step claim as /2fa/verify: one use per 30-second window.
  const currentStep = Math.floor(Date.now() / 30000)
  const claim = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: currentStep } }] },
    data:  { lastUsedTotpStep: currentStep },
  })
  if (claim.count !== 1) {
    return NextResponse.json({ error: 'This code was already used — wait for the next one.' }, { status: 400 })
  }
  return null
}
