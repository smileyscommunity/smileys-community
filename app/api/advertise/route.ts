import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const disposableDomains: string[] = require('disposable-email-domains')

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY not set')
  return new Resend(key)
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const CONTACT_EMAIL = process.env.EMAIL_FROM_ADDRESS ?? 'info@smileyscommunity.com'

const FORMAT_LABELS: Record<string, string> = {
  event_sponsorship: 'Event Sponsorship',
  newsletter:        'Newsletter Feature',
  club_partnership:  'Club Partnership',
  branded_event:     'Branded Event',
  other:             'Not sure yet',
}

// B2B lead intake for /advertise. Unlike /api/contact (fire-and-forget
// email), every accepted submission is persisted as a SponsorLead so the
// pipeline at /admin/sponsors can track it from enquiry to closed deal.
// The email notification is best-effort on top — losing it no longer
// loses the lead.
export async function POST(req: NextRequest) {
  // Slightly looser than /api/contact's 1/hour — legitimate agencies
  // sometimes submit for two clients back to back.
  if (!await rateLimit(`advertise:${getIp(req)}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many enquiries. Try again later.' }, { status: 429 })
  }

  try {
    const { name, email, company, format, message, _hp, _t, _cf } = await req.json()

    // Honeypot check — bots fill this hidden field
    if (_hp) return NextResponse.json({ ok: true })

    // Timing check — must take at least 5 seconds; reject if _t is missing (direct API hit)
    if (!_t || Date.now() - Number(_t) < 5000) {
      return NextResponse.json({ ok: true })
    }

    const ip = getIp(req)
    if (!(await verifyTurnstile(_cf ?? '', ip))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    if (!name?.trim() || !email?.trim() || !company?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Name, email, company and message are required' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (/[\r\n]/.test(name) || /[\r\n]/.test(company)) {
      return NextResponse.json({ error: 'Invalid name or company' }, { status: 400 })
    }
    const domain = email.split('@')[1]?.toLowerCase()
    if (domain && disposableDomains.includes(domain)) {
      return NextResponse.json({ error: 'Please use a permanent email address' }, { status: 400 })
    }
    if (message.trim().length < 10) {
      return NextResponse.json({ error: 'Message is too short' }, { status: 400 })
    }
    if (message.trim().length > 800) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
    }
    const safeFormat = FORMAT_LABELS[format] ? format : 'other'

    const lead = await prisma.sponsorLead.create({
      data: {
        name:    name.trim(),
        email:   email.trim().toLowerCase(),
        company: company.trim(),
        format:  safeFormat,
        message: message.trim(),
      },
    })

    // Notification email is best-effort — the lead row above is the
    // source of truth, so a Resend outage must not fail the request.
    try {
      await getResend().emails.send({
        from:    `Smileys Advertise <${CONTACT_EMAIL}>`,
        to:      CONTACT_EMAIL,
        replyTo: email,
        subject: `[Sponsor Lead] ${esc(company.trim())} — ${FORMAT_LABELS[safeFormat]}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
            <div style="margin-bottom:24px">
              <span style="font-size:24px">😊</span>
              <strong style="margin-left:8px;color:#111827">Smileys Community</strong>
              <p style="color:#6b7280;font-size:13px;margin:4px 0 0">New advertising enquiry</p>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr style="background:#f9fafb">
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280;width:120px">Company</td>
                <td style="padding:10px 14px;font-size:14px;color:#111827">${esc(company.trim())}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280">Contact</td>
                <td style="padding:10px 14px;font-size:14px;color:#111827">${esc(name.trim())} &lt;${esc(email.trim())}&gt;</td>
              </tr>
              <tr style="background:#f9fafb">
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#6b7280">Format</td>
                <td style="padding:10px 14px;font-size:14px;color:#111827">${FORMAT_LABELS[safeFormat]}</td>
              </tr>
            </table>
            <p style="font-size:14px;color:#374151;white-space:pre-wrap">${esc(message.trim())}</p>
            <p style="font-size:13px;color:#6b7280;margin-top:24px">
              Track this lead in <a href="https://smileyscommunity.com/app/admin/sponsors" style="color:#d97706">Admin → Sponsors</a>.
            </p>
          </div>
        `,
      })
    } catch (e) {
      console.error('advertise: notification email failed', e)
    }

    return NextResponse.json({ ok: true, id: lead.id })
  } catch (e) {
    console.error('advertise: lead submission failed', e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
