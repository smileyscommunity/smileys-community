import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY not set')
  return new Resend(key)
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const CONTACT_EMAIL = process.env.EMAIL_FROM_ADDRESS ?? 'info@smileyscommunity.com'

const TOPIC_LABELS: Record<string, string> = {
  general:     'General Inquiry',
  event:       'Event Question',
  club:        'Club Question',
  membership:  'Membership',
  technical:   'Technical Issue',
  partnership: 'Partnership / Collaboration',
  press:       'Media & Press',
  other:       'Other',
}

const SPAM_KEYWORDS = [
  'casino', 'viagra', 'crypto', 'bitcoin', 'nft', 'investment opportunity',
  'click here', 'free money', 'earn money', 'make money', 'work from home',
  'seo service', 'backlink', 'loan offer', 'binary option', 'forex',
  'guaranteed profit', 'passive income', 'mlm', 'pyramid',
  'adult', 'escort', 'dating site', 'enlargement', 'medication',
  'prescription', 'pharmacy', 'weight loss', 'diet pill',
  'followers', 'instagram growth', 'tiktok views', 'youtube views',
  'web design service', 'digital marketing service', 'rank your website',
  'increase traffic', 'boost your',
]

const SPAM_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwam.com',
  'trashmail.com', 'yopmail.com', 'sharklasers.com', 'spam4.me',
  'dispostable.com', 'maildrop.cc',
]

function countUrls(text: string): number {
  return (text.match(/https?:\/\/\S+/gi) ?? []).length
}

function isSpam(text: string, email = ''): boolean {
  const lower = text.toLowerCase()
  // More than 1 URL
  if (countUrls(text) > 1) return true
  // Any URL in a short message is suspicious
  if (countUrls(text) > 0 && text.length < 200) return true
  // Keyword match
  if (SPAM_KEYWORDS.some(kw => lower.includes(kw))) return true
  // Disposable email domain
  const domain = email.split('@')[1]?.toLowerCase()
  if (domain && SPAM_DOMAINS.includes(domain)) return true
  // Excessive caps (>60% uppercase in messages longer than 30 chars)
  if (text.length > 30) {
    const letters = text.replace(/[^a-zA-Z]/g, '')
    const caps    = text.replace(/[^A-Z]/g, '')
    if (letters.length > 0 && caps.length / letters.length > 0.6) return true
  }
  return false
}


export async function POST(req: NextRequest) {
  // Rate limit: 1 per hour per IP
  if (!await rateLimit(`contact:${getIp(req)}`, 1, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many messages. Try again later.' }, { status: 429 })
  }

  try {
    const { name, email, topic, message, _hp, _t, _cf } = await req.json()

    // Honeypot check — bots fill this hidden field
    if (_hp) return NextResponse.json({ ok: true })

    // Timing check — must take at least 5 seconds; reject if _t is missing (direct API hit)
    if (!_t || Date.now() - Number(_t) < 5000) {
      return NextResponse.json({ ok: true })
    }

    // Turnstile verification
    const ip = getIp(req)
    if (!(await verifyTurnstile(_cf ?? '', ip))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Name, email and message are required' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (/[\r\n]/.test(name)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }
    if (message.trim().length < 10) {
      return NextResponse.json({ error: 'Message is too short' }, { status: 400 })
    }
    if (message.trim().length > 3000) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
    }

    // Spam content check
    if (isSpam(message, email) || isSpam(name, email)) {
      return NextResponse.json({ ok: true })
    }

    const topicLabel = TOPIC_LABELS[topic] ?? 'General Inquiry'
    const safeName    = esc(name)
    const safeEmail   = esc(email)
    const safeMessage = esc(message.trim())

    await getResend().emails.send({
      from:    `Smileys Contact Form <${CONTACT_EMAIL}>`,
      to:      CONTACT_EMAIL,
      replyTo: email,
      subject: `[Contact] ${topicLabel} — ${safeName}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <div style="margin-bottom:24px">
            <span style="font-size:24px">😊</span>
            <strong style="margin-left:8px;color:#111827">Smileys Community</strong>
            <p style="color:#6b7280;font-size:13px;margin:4px 0 0">New contact form submission</p>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr style="background:#f9fafb">
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280;width:120px">From</td>
              <td style="padding:10px 14px;font-size:14px;color:#111827">${safeName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#111827"><a href="mailto:${safeEmail}" style="color:#f59e0b">${safeEmail}</a></td>
            </tr>
            <tr style="background:#f9fafb">
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280">Topic</td>
              <td style="padding:10px 14px;font-size:14px;color:#111827">${topicLabel}</td>
            </tr>
          </table>

          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px">
            <p style="font-size:13px;font-weight:600;color:#92400e;margin:0 0 8px">Message</p>
            <p style="font-size:14px;color:#374151;margin:0;white-space:pre-wrap">${safeMessage}</p>
          </div>

          <p style="font-size:12px;color:#9ca3af;margin-top:24px">
            Reply directly to this email to respond to ${safeName}.
          </p>
        </div>
      `,
    })

    // Auto-reply to the sender
    await getResend().emails.send({
      from:    `Smileys Community <${CONTACT_EMAIL}>`,
      to:      email,
      subject: "We've received your message 😊",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <div style="text-align:center;margin-bottom:28px">
            <span style="font-size:40px">😊</span>
            <h2 style="color:#111827;margin:8px 0 0">Thanks, ${esc(name.split(' ')[0])}!</h2>
          </div>
          <p style="color:#374151;font-size:14px;line-height:1.6">
            We've received your message and will get back to you within 24–48 hours.
          </p>
          <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:20px 0">
            <p style="font-size:12px;font-weight:600;color:#6b7280;margin:0 0 4px">Your message</p>
            <p style="font-size:13px;color:#374151;margin:0;white-space:pre-wrap">${message.trim().slice(0, 300)}${message.length > 300 ? '…' : ''}</p>
          </div>
          <p style="color:#6b7280;font-size:13px">
            In the meantime, explore our upcoming events at
            <a href="https://smileyscommunity.com/app/events" style="color:#f59e0b">smileyscommunity.com</a>
          </p>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px">
            Smileys Community · Istanbul, Turkey
          </p>
        </div>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Contact form error:', e)
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 })
  }
}
