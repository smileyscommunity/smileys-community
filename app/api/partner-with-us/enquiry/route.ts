import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'
import { COLLAB_LABELS, PARTNER_CONTACT_EMAIL, PARTNER_LEAD_SOURCE } from '@/lib/partners'
import { isSafeHref } from '@/lib/safeUrl'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const disposableDomains: string[] = require('disposable-email-domains')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// Partnership enquiry from /partners. Same pipeline as /api/advertise — every
// accepted enquiry is a SponsorLead row (Admin → Sponsors), with the event
// facts in their own columns. The response says ok:true ONLY after the row is
// written; the notification email is best-effort on top of it, so a mail
// outage can neither fail the request nor lose the lead.
export async function POST(req: NextRequest) {
  if (!await rateLimit(`partners-enquiry:${getIp(req)}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many enquiries from this connection. Please try again later.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  // Honeypot: the one silent drop, and it is logged.
  if (body._hp) {
    console.warn('[partners-enquiry] dropped: honeypot filled')
    return NextResponse.json({ ok: true })
  }
  const fast = !body._t || Date.now() - Number(body._t) < 5000
  if (fast) console.warn('[partners-enquiry] flagged: sent within 5 seconds')

  if (!(await verifyTurnstile(typeof body._cf === 'string' ? body._cf : '', getIp(req)))) {
    return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
  }

  const name = oneLine(body.name, 120), org = oneLine(body.organization, 160)
  const email = oneLine(body.email, 200).toLowerCase()
  const eventName = oneLine(body.eventName, 160)
  const eventWebsite = oneLine(body.eventWebsite, 300)
  const eventDate = oneLine(body.eventDate, 10)
  const eventVenue = oneLine(body.eventVenue, 160)
  const budgetRange = oneLine(body.budgetRange, 80)
  const srcRaw = oneLine(body.src, 40).toLowerCase()
  const campaignSource = /^[a-z0-9_-]{1,40}$/.test(srcRaw) ? srcRaw : null
  const collab = typeof body.collaboration === 'string' && COLLAB_LABELS[body.collaboration] ? body.collaboration : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!name || !org || !email || !collab || !message) {
    return NextResponse.json({ error: 'Please fill in every required field.' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  const domain = email.split('@')[1]
  if (disposableDomains.includes(domain)) return NextResponse.json({ error: 'Please use a permanent work email address.' }, { status: 400 })
  if (eventWebsite && (!/^https:\/\//i.test(eventWebsite) || !isSafeHref(eventWebsite))) {
    return NextResponse.json({ error: 'Event website must be a full link starting with https://' }, { status: 400 })
  }
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(eventDate)))) {
    return NextResponse.json({ error: 'Event date is not valid.' }, { status: 400 })
  }
  if (message.length < 10) return NextResponse.json({ error: 'Please tell us a little more in your message.' }, { status: 400 })
  if (message.length > 1500) return NextResponse.json({ error: 'Message is too long (1,500 characters max).' }, { status: 400 })

  let id: string
  try {
    const lead = await prisma.sponsorLead.create({
      data: {
        name, email, company: org, message,
        format: `partner_${collab}`, source: PARTNER_LEAD_SOURCE,
        eventName: eventName || null, eventWebsite: eventWebsite || null, eventDate: eventDate || null,
        eventVenue: eventVenue || null, budgetRange: budgetRange || null, campaignSource,
      },
      select: { id: true },
    })
    id = lead.id
  } catch (e) {
    console.error('partners-enquiry: lead not saved', e)
    return NextResponse.json({ error: 'We could not save your enquiry. Please try again, or email us directly.' }, { status: 500 })
  }

  try {
    const key = process.env.RESEND_API_KEY
    if (key) {
      await new Resend(key).emails.send({
        from: `Smileys Partners <${PARTNER_CONTACT_EMAIL}>`,
        to: PARTNER_CONTACT_EMAIL,
        replyTo: email,
        subject: `[Partnership]${fast ? ' ⚠ check: sent within 5 seconds' : ''} ${eventName || org} — ${COLLAB_LABELS[collab]}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px">
          <p><strong>${esc(org)}</strong> — ${esc(name)} &lt;${esc(email)}&gt;</p>
          <p>${eventName ? `Event: ${esc(eventName)}${eventDate ? ` · ${esc(eventDate)}` : ''}${eventVenue ? ` · ${esc(eventVenue)}` : ''}<br>` : ''}${eventWebsite ? `Website: ${esc(eventWebsite)}<br>` : ''}${budgetRange ? `Budget (stated): ${esc(budgetRange)}<br>` : ''}Collaboration: ${esc(COLLAB_LABELS[collab])}</p>
          <p style="white-space:pre-wrap">${esc(message)}</p>
          <p style="color:#6b7280;font-size:13px">Track it in Admin → Sponsors.</p></div>`,
      })
    }
  } catch (e) {
    console.error('partners-enquiry: notification email failed', e)
  }

  return NextResponse.json({ ok: true, id })
}
