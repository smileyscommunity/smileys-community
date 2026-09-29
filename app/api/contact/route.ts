import { NextRequest, NextResponse } from 'next/server'
import { APP_URL } from '@/lib/env'
import { getPublicCity } from '@/lib/cities'
import { getSession } from '@/lib/session'
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
  // A correction or an addition to a Handbook article — the article page's
  // "Send a tip" lands here, with the slug in the message.
  handbook:    'Handbook article',
  // A member nominating the next "Working from" interviewee — the remote-work
  // hub's link lands here with the city in the message (lib/remoteWork).
  nominate:    'Working from — nomination',
  // /get-involved's "Offer to host" and "Propose a club" (2026-09-29): an
  // offer to run something arrived as a General Inquiry with no city.
  host:        'Offer to host',
  'club-proposal': 'Club proposal',
  city:        'City suggestion',
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


// Topics that are someone offering to do something for the community. The
// spam words ("adult", "followers", "work from home", "crypto", a link in a
// short message) are ordinary in a club pitch — "a board-games night for
// young adults" — so on these topics a match flags the email instead of
// silently dropping it behind a "Message sent!".
const OFFER_TOPICS = new Set(['host', 'club-proposal', 'city', 'nominate'])

export async function POST(req: NextRequest) {
  try {
    const { name, email, topic, message, city: cityRaw, _hp, _t, _cf } = await req.json()

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

    // 3 an hour per address, counted only for a message that would actually
    // be sent — it was 1 an hour counted before any check, so a typo in the
    // email locked the sender out for an hour, and one person on a café or
    // campus network used it up for everyone there.
    if (!await rateLimit(`contact:${getIp(req)}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many messages from this network in the last hour. Try again later, or email info@smileyscommunity.com.' }, { status: 429 })
    }

    // Spam content check — dropped silently for general topics, flagged for
    // offers (see OFFER_TOPICS).
    const spammy = isSpam(message, email) || isSpam(name, email)
    if (spammy && !OFFER_TOPICS.has(topic)) {
      return NextResponse.json({ ok: true })
    }

    // Which city this is about (a public slug from ?city=) and, when signed
    // in, which member sent it — a host offer from Bodrum used to reach the
    // one inbox with neither.
    const citySlug = typeof cityRaw === 'string' ? cityRaw.trim().toLowerCase().slice(0, 60) : ''
    const cityRow  = citySlug ? await getPublicCity(citySlug) : null
    const session  = await getSession()

    const topicLabel = TOPIC_LABELS[topic] ?? 'General Inquiry'
    const safeName    = esc(name)
    const safeEmail   = esc(email)
    const safeMessage = esc(message.trim())

    await getResend().emails.send({
      from:    `Smileys Contact Form <${CONTACT_EMAIL}>`,
      to:      CONTACT_EMAIL,
      replyTo: email,
      subject: `[Contact]${spammy ? ' ⚠ check: spam words' : ''} ${topicLabel}${cityRow ? ` · ${esc(cityRow.name)}` : ''} — ${safeName}`,
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
            ${cityRow ? `<tr>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280">City</td>
              <td style="padding:10px 14px;font-size:14px;color:#111827">${esc(cityRow.name)}</td>
            </tr>` : ''}
            ${session ? `<tr style="background:#f9fafb">
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280">Member</td>
              <td style="padding:10px 14px;font-size:14px;color:#111827"><a href="${APP_URL}/admin/users/${esc(session.id)}" style="color:#f59e0b">${esc(session.name)}</a></td>
            </tr>` : ''}
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

    // No auto-reply. Sending one to whatever `email` was supplied turns this
    // endpoint into a reflective email tool: an attacker could DOS or phish
    // a victim by submitting `victim@example.com` and a crafted "Your message"
    // that we'd then dutifully forward from our own domain (1/h/IP limit
    // doesn't stop a distributed sender). The form's UI shows
    // "Message received — we'll get back to you" so the sender doesn't need
    // an email to feel acknowledged.

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Contact form error:', e)
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 })
  }
}
