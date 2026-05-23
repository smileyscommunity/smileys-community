import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { generateSecret, generateURI, verifySync } from 'otplib/functional'
import QRCode from 'qrcode'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpEnabled: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.totpEnabled) return NextResponse.json({ error: 'Already enabled' }, { status: 400 })

  const secret = generateSecret()
  await prisma.user.update({ where: { id: session.id }, data: { totpSecret: secret } })

  const otpauth = generateURI({ label: user.email, issuer: 'Smileys Community', secret, strategy: 'totp' } as any)
  const qrDataUrl = await QRCode.toDataURL(otpauth)

  return NextResponse.json({ qrDataUrl })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpSecret: true, totpEnabled: true },
  })
  if (!user?.totpSecret) return NextResponse.json({ error: 'Run setup first' }, { status: 400 })
  if (user.totpEnabled) return NextResponse.json({ error: 'Already enabled' }, { status: 400 })

  const result = verifySync({ token: String(code), secret: user.totpSecret, strategy: 'totp' } as any)
  if (!(result as any).valid) return NextResponse.json({ error: 'Invalid code — try again' }, { status: 400 })

  await prisma.user.update({ where: { id: session.id }, data: { totpEnabled: true } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpSecret: true, totpEnabled: true },
  })
  if (!user?.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
  }

  const result = verifySync({ token: String(code), secret: user.totpSecret, strategy: 'totp' } as any)
  if (!(result as any).valid) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })

  await prisma.user.update({
    where: { id: session.id },
    data: { totpEnabled: false, totpSecret: null },
  })
  return NextResponse.json({ ok: true })
}
