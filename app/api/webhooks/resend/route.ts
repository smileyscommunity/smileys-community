import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Resend uses svix for webhook delivery. Signature format:
// HMAC-SHA256(key=base64decode(secret), msg="{svix-id}.{svix-timestamp}.{body}")
// Multiple sigs may appear space-separated: "v1,<b64sig1> v1,<b64sig2>"
function verifySignature(body: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return false

  const msgId        = headers.get('svix-id')
  const msgTimestamp = headers.get('svix-timestamp')
  const msgSignature = headers.get('svix-signature')
  if (!msgId || !msgTimestamp || !msgSignature) return false

  // Reject if timestamp is outside ±5 minutes
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(msgTimestamp, 10)) > 300) return false

  const toSign     = `${msgId}.${msgTimestamp}.${body}`
  const secretBuf  = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const computed   = createHmac('sha256', secretBuf).update(toSign).digest('base64')
  const computedBuf = Buffer.from(computed)

  return msgSignature.split(' ').some(sig => {
    const [, b64] = sig.split(',')
    if (!b64) return false
    try {
      const sigBuf = Buffer.from(b64)
      return sigBuf.length === computedBuf.length && timingSafeEqual(sigBuf, computedBuf)
    } catch { return false }
  })
}

type ResendEvent = {
  type: string
  data: {
    email_id?: string
    // Resend delivers `to` as an array of recipient addresses
    to?: string[]
    bounce?: { type?: string }  // 'HardBounce' | 'SoftBounce' | 'Transient'
  }
}

// Suppress marketing emails for a user and log why. Used for both hard
// bounces and spam complaints — different signals, same outcome.
async function suppressEmail(email: string, reason: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where:  { email: email.toLowerCase() },
    select: { id: true, emailMarketing: true },
  })
  if (!user || !user.emailMarketing) return  // already suppressed

  await prisma.user.update({
    where: { id: user.id },
    data:  { emailMarketing: false },
  })
  console.warn(`[resend-webhook] emailMarketing suppressed — ${reason}: ${email}`)
}

export async function POST(req: NextRequest) {
  const body = await req.text()

  if (!verifySignature(body, req.headers)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: ResendEvent
  try { event = JSON.parse(body) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const resendId = event.data?.email_id
  if (!resendId) return NextResponse.json({ ok: true })

  switch (event.type) {
    case 'email.opened':
    case 'email.clicked': {
      const log = await prisma.newsletterEmailLog.findUnique({
        where:  { resendId },
        select: { newsletterId: true },
      })
      if (log) {
        await prisma.newsletter.update({
          where: { id: log.newsletterId },
          data:  event.type === 'email.opened'
            ? { openCount:  { increment: 1 } }
            : { clickCount: { increment: 1 } },
        })
      }
      break
    }

    case 'email.bounced': {
      // Only suppress on hard bounces — soft/transient are temporary
      // failures (full inbox, server hiccup) that may resolve on retry.
      // Hard bounces mean the address is permanently undeliverable;
      // continuing to send harms our domain reputation.
      const bounceType = event.data.bounce?.type ?? ''
      if (bounceType === 'HardBounce') {
        const emails = event.data.to ?? []
        await Promise.all(emails.map(e => suppressEmail(e, 'hard-bounce')))
      }
      break
    }

    case 'email.complained': {
      // Spam complaint — user marked the email as junk. Suppress
      // immediately regardless of bounce type and credit the newsletter's
      // unsubscribe counter so deliverability can be tracked over time.
      const emails = event.data.to ?? []
      await Promise.all(emails.map(e => suppressEmail(e, 'spam-complaint')))

      // If this was a newsletter send, bump its unsubscribe counter
      const log = await prisma.newsletterEmailLog.findUnique({
        where:  { resendId },
        select: { newsletterId: true },
      })
      if (log) {
        await prisma.newsletter.update({
          where: { id: log.newsletterId },
          data:  { unsubscribeCount: { increment: emails.length || 1 } },
        })
      }
      break
    }
  }

  return NextResponse.json({ ok: true })
}
