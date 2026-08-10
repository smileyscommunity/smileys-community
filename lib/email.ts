import { Resend } from 'resend'
import { unsubscribeUrl } from '@/lib/unsubscribe'
import { APP_URL as ENV_APP_URL } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

const FROM    = process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>'
const APP_URL = ENV_APP_URL

/**
 * HTML-escape any user / host / admin-supplied string before it lands in a
 * template literal that becomes the email body. Without this, a listing
 * author or event host could inject `<a>` / `<img>` / `<style>` tags into
 * emails blasted to subscribers or RSVP'd attendees — phishing payload at
 * scale. Mail clients vary in how aggressively they sanitize incoming HTML;
 * defense in depth is to escape at the source.
 *
 * The 5-char minimal set (& < > " ') is sufficient for HTML body context.
 * Do NOT use this on intentional HTML content (e.g. admin broadcast bodyHtml).
 */
function esc(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Strip CR/LF from a subject line. Resend strips these too, but
 * defense-in-depth: user-supplied event/listing titles can otherwise be a
 * SMTP header-injection vector if Resend ever changes behavior.
 */
function safeSubject(s: string): string {
  return String(s).replace(/[\r\n]+/g, ' ').slice(0, 200)
}

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not set')
  return new Resend(key)
}

// #4 monitoring: every send*Email .catch in the app now also
// calls this. It writes a row to email_failures + logs to console
// so the admin dashboard tile can flag "X email failures in last
// 24h" instead of waiting for members to complain. Caller stays
// responsible for the console.error so the route-prefixed log
// line stays grep-able; this helper handles the persistent
// side of the trail.
//
// Wrapped in its own try/catch — if the failure-recording itself
// fails (DB down, schema migration in progress), don't bubble it
// up into the email-sending caller's flow.
// Turn any thrown value into a readable string. Resend errors are plain
// objects ({ name, message, statusCode }), which String() renders as the
// useless "[object Object]" — the reason the newsletter failures couldn't be
// diagnosed. Fall back to JSON so the real message is captured.
export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

export async function recordEmailFailure(opts: {
  helper:    string
  recipient: string
  error:     unknown
  context?:  Record<string, unknown>
}): Promise<void> {
  try {
    const errMsg = serializeError(opts.error)
    await prisma.emailFailure.create({
      data: {
        helper:    opts.helper,
        recipient: opts.recipient.slice(0, 320),
        error:     errMsg.slice(0, 500),
        context:   opts.context ? (opts.context as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch (recordErr) {
    console.error('[recordEmailFailure] failed to persist failure row', { recordErr: String(recordErr) })
  }
}

export async function sendVerificationEmail(email: string, name: string, token: string) {
  const url = `${APP_URL}/verify-email?token=${token}`
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'Verify your Smileys account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Welcome to Smileys, ${esc(name)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Please verify your email to get started</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:24px">
          Verify my email
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          This link expires in 24 hours. If you didn't create an account, ignore this email.
        </p>
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0"/>
        <p style="color:#d1d5db;font-size:11px;text-align:center">Or copy this link: ${url}</p>
      </div>
    `,
  })
}

// Sent when someone tries to re-register an already-verified
// account. Lets the legit owner act on it (sign in or rotate
// password) without the register endpoint having to reveal
// "this email is already in use" — which was an enumeration
// vector. See app/api/auth/register/route.ts.
export async function sendAlreadyRegisteredEmail(email: string, name: string) {
  const loginUrl  = `${APP_URL}/login`
  const forgotUrl = `${APP_URL}/forgot-password`
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'Someone tried to register with your Smileys email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:24px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">Hi ${esc(name)},</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Someone just tried to register a Smileys account with this email — but you already have one.</p>
        </div>
        <a href="${loginUrl}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:12px">
          Sign in
        </a>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:0 0 24px">
          Forgot your password? <a href="${forgotUrl}" style="color:#f59e0b;font-weight:600;text-decoration:none">Reset it here</a>.
        </p>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          If that wasn't you, you can safely ignore this email — your account is unchanged.
        </p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(email: string, name: string, token: string) {
  const url = `${APP_URL}/reset-password?token=${token}`
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'Reset your Smileys password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Reset your password</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Hi ${esc(name)}, click below to set a new password</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:24px">
          Reset my password
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          This link expires in 1 hour. If you didn't request this, ignore this email.
        </p>
      </div>
    `,
  })
}

export async function sendApplicationReceivedEmail(email: string, name: string) {
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'We received your application 😊',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Thanks for applying, ${esc(name)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Your application has been received</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0;line-height:1.6">
            Our team personally reviews every application to keep Smileys a high-quality community.
            We'll get back to you within <strong>24 hours</strong>.
          </p>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          Questions? Reply to this email or reach us at info@smileyscommunity.com
        </p>
      </div>
    `,
  })
}

export async function sendAdminNewApplicationEmail(applicantName: string, applicantEmail: string) {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'info@smileyscommunity.com'
  await getResend().emails.send({
    from: FROM, to: adminEmail,
    subject: safeSubject(`New application: ${applicantName}`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 16px">New membership application</h2>
        <p style="color:#374151;font-size:14px;margin:0 0 8px"><strong>Name:</strong> ${esc(applicantName)}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 24px"><strong>Email:</strong> ${esc(applicantEmail)}</p>
        <a href="${APP_URL}/admin/applications" style="display:inline-block;background:#111;color:#fff;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
          Review application →
        </a>
      </div>
    `,
  })
}

// Fires once per directory submission (non-admin submitters only — admin
// submissions are auto-approved). Sent to the same single ADMIN_EMAIL
// inbox the application emails go to; the in-app + push notifications
// in lib/notify.ts still fan out to every admin / moderator.
export async function sendAdminNewDirectorySubmissionEmail(submitterName: string, businessName: string) {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'info@smileyscommunity.com'
  await getResend().emails.send({
    from: FROM, to: adminEmail,
    subject: safeSubject(`New directory submission: ${businessName}`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 16px">New business submitted to the directory</h2>
        <p style="color:#374151;font-size:14px;margin:0 0 8px"><strong>Business:</strong> ${esc(businessName)}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 24px"><strong>Submitted by:</strong> ${esc(submitterName)}</p>
        <a href="${APP_URL}/admin/directory" style="display:inline-block;background:#111;color:#fff;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
          Review submission →
        </a>
      </div>
    `,
  })
}

// Celebratory note when an admin upgrades a member to premium/VIP.
// Pairs with the in-app 'membership_upgraded' notification.
export async function sendPremiumUpgradeEmail(email: string, name: string, tier: string) {
  await getResend().emails.send({
    from: FROM, to: email,
    subject: `You're now a Smileys ${tier} member 🎉`,
    text: `Hi ${name},

Great news — your Smileys membership has been upgraded to ${tier}.

Your ${tier} badge now appears across the community: on your profile, in the member directory, and on your digital member card.

Thanks for being part of Smileys.

Warmly,
Smileys Community Team`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:520px">
        <p>Hi ${esc(name)},</p>
        <p>Great news — your Smileys membership has been upgraded to <strong>${esc(tier)}</strong> 🎉</p>
        <p>Your <strong>${esc(tier)}</strong> badge now appears across the community: on your profile, in the member directory, and on your digital member card.</p>
        <p>Thanks for being part of Smileys.</p>
        <p style="margin-top:24px">Warmly,<br/><strong>Smileys Community Team</strong> 💛</p>
      </div>
    `,
  })
}

export async function sendApplicationRejectedEmail(email: string, name: string, message?: string) {
  const body = message?.trim()
    ? message.trim()
    : 'After careful review, we don\'t think it\'s the right fit at this time. You\'re welcome to reapply in the future.'
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'Your Smileys application',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Hi ${esc(name)},</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">An update on your Smileys application</p>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <p style="color:#374151;font-size:14px;margin:0;line-height:1.6">${esc(body)}</p>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          Questions? Reach us at info@smileyscommunity.com
        </p>
      </div>
    `,
  })
}

export async function sendRequestMoreInfoEmail(email: string, name: string, message: string) {
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'We\'d love to know more — Smileys',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Hi ${esc(name)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">We're reviewing your application</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0;line-height:1.6">${esc(message)}</p>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          Reply to this email or reach us at info@smileyscommunity.com
        </p>
      </div>
    `,
  })
}

export async function sendActivationEmail(email: string, name: string, token: string, welcomeMessage?: string) {
  const url        = `${APP_URL}/activate?token=${token}`
  const firstName  = name.split(' ')[0]
  // Escape user-supplied welcomeMessage FIRST, then convert newlines to <br>.
  // Doing it the other way around would let an admin inject HTML by typing
  // `<img onerror=...>` in the welcome-note field.
  const personalNote = welcomeMessage
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
        <p style="color:#92400e;font-size:14px;margin:0;line-height:1.6">${esc(welcomeMessage).replace(/\n/g, '<br>')}</p>
       </div>`
    : ''
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`You're in, ${firstName}! Activate your Smileys account`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Welcome to Smileys, ${esc(firstName)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Your application has been approved.</p>
        </div>
        ${personalNote}
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:24px">
          Set your password &amp; join →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          This link expires in 7 days. Istanbul's most curated community is waiting for you.
        </p>
      </div>
    `,
  })
}

export async function sendLoginNudgeEmail(email: string, name: string, token: string, nudgeNumber: number) {
  const url       = `${APP_URL}/activate?token=${token}`
  const firstName = name.split(' ')[0]
  const subject   = nudgeNumber === 1
    ? safeSubject(`${firstName}, your Smileys account is waiting for you`)
    : safeSubject(`Last reminder — your Smileys spot is still open, ${firstName}`)
  await getResend().emails.send({
    from: FROM, to: email,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">👋</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">You're approved — but haven't joined yet</h1>
          <p style="color:#6b7280;font-size:14px;margin:0;line-height:1.6">
            Your Smileys application was accepted. We saved your spot, but you haven't set up your account yet.
          </p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:20px">
          Set your password &amp; join now →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0">
          This link expires in 7 days. Events, clubs, and your community are waiting.
        </p>
      </div>
    `,
  })
}

export async function sendEventApprovedEmail(email: string, name: string, eventTitle: string, eventDate: string, eventNeighborhood: string, eventId: string) {
  const url = `${APP_URL}/events/${eventId}`
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`You're in for "${eventTitle}" 🎉`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">🎉</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">You're approved, ${esc(name)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Your spot for <strong>${esc(eventTitle)}</strong> is confirmed.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0"><strong>📅</strong> ${esc(eventDate)}</p>
          <p style="color:#92400e;font-size:14px;margin:6px 0 0"><strong>📍</strong> ${esc(eventNeighborhood)} — exact location revealed in the app</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:24px">
          View event details →
        </a>
      </div>
    `,
  })
}

export async function sendEventRejectedEmail(email: string, name: string, eventTitle: string) {
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`Update on your request for "${eventTitle}"`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Hi ${esc(name)},</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">An update on your request</p>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#374151;font-size:14px;margin:0;line-height:1.6">
            Unfortunately we couldn't approve your request for <strong>${esc(eventTitle)}</strong> this time — it may be full or the event criteria didn't match.
            Keep an eye on upcoming events and apply again!
          </p>
        </div>
        <a href="${APP_URL}/events" style="display:block;text-align:center;background:#111;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none">
          Browse other events →
        </a>
      </div>
    `,
  })
}

export async function sendRsvpConfirmationEmail(email: string, name: string, eventTitle: string, eventDate: string, eventLocation: string, eventId: string) {
  const url = `${APP_URL}/events/${eventId}`
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`You're going to "${eventTitle}" 🎉`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">🎉</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">You're in, ${esc(firstName)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Your spot for <strong>${esc(eventTitle)}</strong> is confirmed.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0"><strong>📅</strong> ${esc(eventDate)}</p>
          <p style="color:#92400e;font-size:14px;margin:6px 0 0"><strong>📍</strong> ${esc(eventLocation)}</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          View event →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">See you there. If your plans change, please cancel your spot so others can join.</p>
      </div>
    `,
  })
}

export async function sendReviewRequestEmail(email: string, name: string, eventTitle: string, eventEmoji: string) {
  const url = `${APP_URL}/reviews`
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`How was "${eventTitle}"? Share your review`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:48px">${esc(eventEmoji)}</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:12px 0 4px">How was it, ${esc(firstName)}?</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">You attended <strong>${esc(eventTitle)}</strong> — we'd love to hear what you thought.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0;line-height:1.6">
            Your honest review helps hosts improve and helps members decide which events to join.
            It takes less than a minute!
          </p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          Leave a review →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          You can also edit or delete your reviews any time from the Reviews page.
        </p>
      </div>
    `,
  })
}

export async function sendWaitlistPromotedEmail(email: string, name: string, eventTitle: string, eventDate: string, eventId: string) {
  const url = `${APP_URL}/events/${eventId}`
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`A spot just opened — you're in for "${eventTitle}"`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">🙌</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Good news, ${esc(firstName)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">A spot opened up — you've been moved off the waitlist for <strong>${esc(eventTitle)}</strong>.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0"><strong>📅</strong> ${esc(eventDate)}</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          View event →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">Your spot is confirmed. If plans change, please cancel so the next person can join.</p>
      </div>
    `,
  })
}

// Sent to every waitlist member when an approved attendee cancels and
// frees up a spot. First-come-first-served — whoever taps the CTA and
// hits Join first gets in (race-safety lives in the POST /rsvp route,
// which uses a Serializable transaction). Replaced the old "you're
// promoted, congrats" silent flow because auto-promotion produced
// no-shows: the first person on the waitlist often had moved on by
// the time the spot opened. Making members actively claim is a much
// better signal of intent.
export async function sendSpotOpenedEmail(email: string, name: string, eventTitle: string, eventDate: string, eventId: string) {
  const url = `${APP_URL}/events/${eventId}`
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`A spot just opened for "${eventTitle}" — claim it!`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">🚪</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Quick, ${esc(firstName)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">A spot just opened for <strong>${esc(eventTitle)}</strong>. First come, first served — claim it before someone else does.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0"><strong>📅</strong> ${esc(eventDate)}</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          Claim the spot →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">Tap Join on the event page. If someone beats you to it, you'll stay on the waitlist for next time.</p>
      </div>
    `,
  })
}

export async function sendEventCancelledEmail(email: string, name: string, eventTitle: string, eventDate: string) {
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`"${eventTitle}" has been cancelled`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">😔</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Hi ${esc(firstName)},</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Unfortunately <strong>${esc(eventTitle)}</strong> (${esc(eventDate)}) has been cancelled.</p>
        </div>
        <p style="color:#374151;font-size:14px;text-align:center;margin-bottom:24px">We're sorry for the inconvenience. Keep an eye out for upcoming events.</p>
        <a href="${APP_URL}/events" style="display:block;text-align:center;background:#111;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none">
          Browse upcoming events →
        </a>
      </div>
    `,
  })
}

export async function sendRefundEmail(email: string, name: string, eventTitle: string, amount: number, currency: string, note?: string) {
  const firstName = name.split(' ')[0]
  const noteHtml = note
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:24px">
        <p style="color:#374151;font-size:14px;margin:0;line-height:1.6">${esc(note)}</p>
       </div>`
    : ''
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`Your refund for "${eventTitle}"`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">💳</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Refund confirmed, ${esc(firstName)}</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">A refund of <strong>${esc(currency)} ${amount.toLocaleString()}</strong> for <strong>${esc(eventTitle)}</strong> has been processed.</p>
        </div>
        ${noteHtml}
        <p style="color:#9ca3af;font-size:12px;text-align:center">Questions? Reply to this email or reach us at info@smileyscommunity.com</p>
      </div>
    `,
  })
}

export async function sendApplicationApprovedEmail(email: string, name: string) {
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'You\'re in! Welcome to Smileys 🎉',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:40px">😊</span>
          <h1 style="font-size:24px;font-weight:800;color:#111;margin:8px 0 4px">Welcome to Smileys, ${esc(name)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Your application has been approved</p>
        </div>
        <a href="${APP_URL}/onboarding?email=${encodeURIComponent(email)}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:24px">
          Create your account →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          Istanbul's most curated social community is waiting for you.
        </p>
      </div>
    `,
  })
}

export async function sendNewDeviceLoginEmail(email: string, name: string, ip: string, time: string) {
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'New login to your Smileys account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">🔐</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">New login detected</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Hi ${esc(firstName)}, your Smileys account was just accessed from a new location.</p>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0 0 4px"><strong>🌐 IP address:</strong> ${esc(ip)}</p>
          <p style="color:#92400e;font-size:14px;margin:0"><strong>🕐 Time:</strong> ${esc(time)}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6">If this was you, no action is needed. If you did not log in, your account may be compromised — change your password immediately.</p>
        <a href="${APP_URL}/settings" style="display:block;text-align:center;background:#ef4444;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-top:20px">
          Secure my account →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px">Smileys Community · Istanbul</p>
      </div>
    `,
  })
}

export async function sendAccountLockedEmail(email: string, name: string) {
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: 'Your Smileys account has been temporarily locked',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">🔒</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">Account locked</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">Hi ${esc(firstName)}, your account has been locked after 10 failed login attempts.</p>
        </div>
        <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#991b1b;font-size:14px;margin:0">Your account will unlock automatically in <strong>1 hour</strong>. If you forgot your password, use the link below.</p>
        </div>
        <a href="${APP_URL}/forgot-password" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:12px">
          Reset my password →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">If you didn't attempt to log in, someone is trying to access your account. Contact us at info@smileyscommunity.com</p>
      </div>
    `,
  })
}

export async function sendListingExpiryEmail(email: string, name: string, listingTitle: string, daysLeft: number) {
  const url       = `${APP_URL}/board`
  const firstName = name.split(' ')[0]
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`Your listing "${listingTitle}" expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">📋</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">Hey ${esc(firstName)}, your listing is expiring soon</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">
            <strong>${esc(listingTitle)}</strong> will be removed from the Community Board in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>.
          </p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0">Renew it now to keep your listing visible to ${4000}+ Smileys members.</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          Renew listing →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">If the listing is no longer relevant, you can let it expire — no action needed.</p>
      </div>
    `,
  })
}

export async function sendBroadcastEmail(
  userId: string,
  email: string,
  name: string,
  title: string,
  message: string,
) {
  const unsub     = unsubscribeUrl(userId)
  const firstName = name.split(' ')[0]
  // Escape paragraph text BEFORE wrapping in <p>/<br> — admin can otherwise
  // inject HTML via the broadcast composer. Lower risk than user-supplied
  // content (admin-only) but defense-in-depth for a compromised admin session.
  const bodyHtml  = message
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

  await getResend().emails.send({
    from:    FROM,
    to:      email,
    subject: title,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px 32px;border:1px solid #e5e7eb">
        <div style="margin-bottom:28px">
          <p style="margin:0;font-size:14px;color:#6b7280;white-space:nowrap"><span style="font-size:26px;vertical-align:-5px">😊</span>&nbsp;<strong style="color:#374151">Smileys&nbsp;Community</strong>&nbsp;·&nbsp;Istanbul</p>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#111827;margin:0 0 20px">${esc(title)}</h2>
        <p style="margin:0 0 16px;color:#374151;font-size:14px">Hi ${esc(firstName)},</p>
        ${bodyHtml}
        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f3f4f6">
          <a href="${APP_URL}/events"
            style="display:inline-block;background:#f59e0b;color:#fff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
            Browse upcoming events →
          </a>
        </div>
        <p style="margin-top:24px;font-size:13px">
          <a href="https://www.instagram.com/smileys.community" style="color:#b45309;font-weight:600;text-decoration:none">Instagram</a>
          <span style="color:#d1d5db">·</span>
          <a href="https://www.whatsapp.com/channel/0029VaCKyc29hXF4fZuOod1K" style="color:#b45309;font-weight:600;text-decoration:none">WhatsApp channel</a>
          <span style="color:#d1d5db">·</span>
          <a href="https://linkedin.com/company/smileys-community" style="color:#b45309;font-weight:600;text-decoration:none">LinkedIn</a>
          <span style="color:#d1d5db">·</span>
          <a href="https://www.facebook.com/aswistanbul/" style="color:#b45309;font-weight:600;text-decoration:none">Facebook</a>
        </p>
        <p style="color:#9ca3af;font-size:11px;margin-top:16px;line-height:1.5">
          You're receiving this because you're a member of Smileys Community.<br>
          <a href="${unsub}" style="color:#9ca3af">Unsubscribe from newsletters</a>
        </p>
      </div>
    `,
  })
}

// A single low-pressure "your first Smileys event?" invite, personalised to the
// event the matcher picked. Sent by the weekly first-RSVP nudge cron to members
// who've joined but never RSVP'd. Email (not push) so it reaches dormant members
// without adding notification load; unsubscribe respects emailMarketing.
export async function sendFirstEventNudgeEmail(
  userId: string,
  email: string,
  name: string,
  ev: { id: string; title: string; date: string; time: string | null; neighborhood: string | null; emoji: string | null; attendees: number; isFirstTimerFriendly: boolean },
) {
  const unsub     = unsubscribeUrl(userId)
  const firstName = name.split(' ')[0]
  const pretty    = new Date(ev.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const meta      = [ev.neighborhood, `${pretty}${ev.time ? ` · ${ev.time}` : ''}`].filter(Boolean).map(x => esc(String(x))).join(' · ')
  const going     = ev.attendees > 0 ? `${ev.attendees} ${ev.attendees === 1 ? 'person is' : 'people are'} going` : ''
  await getResend().emails.send({
    from: FROM, to: email,
    subject: `${ev.emoji ? ev.emoji + ' ' : ''}${ev.title} — your first Smileys event?`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px 32px;border:1px solid #e5e7eb">
        <p style="margin:0 0 28px;font-size:14px;color:#6b7280"><span style="font-size:26px;vertical-align:-5px">😊</span>&nbsp;<strong style="color:#374151">Smileys&nbsp;Community</strong>&nbsp;·&nbsp;Istanbul</p>
        <h2 style="font-size:20px;font-weight:800;color:#111827;margin:0 0 16px">Your first Smileys event? 👋</h2>
        <p style="margin:0 0 8px;color:#374151;font-size:14px">Hi ${esc(firstName)},</p>
        <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6">You joined Smileys but haven't been to an event yet — no pressure at all. Here's one we think would make a lovely first, close to you:</p>
        <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:14px;padding:20px">
          <p style="margin:0;font-size:17px;font-weight:800;color:#111827">${ev.emoji ? esc(ev.emoji) + ' ' : ''}${esc(ev.title)}</p>
          <p style="margin:6px 0 0;color:#b45309;font-size:13px;font-weight:600">${meta}</p>
          ${going ? `<p style="margin:8px 0 0;color:#6b7280;font-size:13px">👥 ${going}</p>` : ''}
          ${ev.isFirstTimerFriendly ? `<p style="margin:8px 0 0;color:#15803d;font-size:12px;font-weight:700">✅ First-timers especially welcome</p>` : ''}
          <a href="${APP_URL}/events/${ev.id}?utm_source=first_rsvp_nudge" style="display:inline-block;margin-top:16px;background:#f59e0b;color:#fff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">See the event →</a>
        </div>
        <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6">Not your thing? <a href="${APP_URL}/events?utm_source=first_rsvp_nudge" style="color:#b45309;font-weight:600;text-decoration:none">Browse everything on this week →</a> Just come as you are and say hi — that's all it takes.</p>
        <p style="color:#9ca3af;font-size:11px;margin-top:24px;line-height:1.5">You're receiving this because you're a member of Smileys Community.<br><a href="${unsub}" style="color:#9ca3af">Unsubscribe from these emails</a></p>
      </div>`,
  })
}

// Internal weekly summary of the first-RSVP nudge cron, sent to admins so the
// loop reports its own results (send volume + running RSVP conversion).
export async function sendNudgeReportEmail(
  to: string,
  r: { emailed: number; matched: number; segment: number; interestMatched: number; sameHood: number; priorNudged: number; priorConverted: number
       heldOut?: number; expTreated?: number; expTreatedConverted?: number; expControl?: number; expControlConverted?: number },
) {
  const rate = r.priorNudged > 0 ? Math.round(100 * r.priorConverted / r.priorNudged) : 0
  const pct  = (n: number, d: number) => (d > 0 ? `${Math.round(1000 * n / d) / 10}%` : '—')
  // The blended "conversion so far" number above can't tell the nudge apart
  // from members who would have RSVP'd anyway. The arm split is the read.
  const arms = (r.expTreated ?? 0) + (r.expControl ?? 0) > 0
    ? `
        <p style="color:#374151;font-size:14px;line-height:1.7;margin:14px 0 0;padding:12px;background:#f9fafb;border-radius:8px">
          <strong>Holdout experiment</strong> (members assigned since the holdout shipped):<br>
          Emailed: <strong>${r.expTreatedConverted ?? 0}/${r.expTreated ?? 0}</strong> RSVP'd (${pct(r.expTreatedConverted ?? 0, r.expTreated ?? 0)})<br>
          Held back: <strong>${r.expControlConverted ?? 0}/${r.expControl ?? 0}</strong> RSVP'd (${pct(r.expControlConverted ?? 0, r.expControl ?? 0)})<br>
          <span style="color:#6b7280;font-size:12px">Both arms were matched to a real event; only the first was emailed.</span>
        </p>`
    : ''
  await getResend().emails.send({
    from: FROM, to,
    subject: `First-RSVP nudge: ${r.emailed} sent · ${rate}% converting`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;margin:0 0 12px;color:#111827">First-RSVP nudge — weekly run</h2>
        <p style="color:#374151;font-size:14px;line-height:1.7;margin:0">
          <strong>${r.emailed}</strong> members emailed this week (of ${r.matched} matched / ${r.segment} in segment)${r.heldOut ? `, <strong>${r.heldOut}</strong> held back as controls` : ''}.<br>
          ${r.interestMatched} matched on a stated interest · ${r.sameHood} in their own neighbourhood.
        </p>
        <p style="color:#374151;font-size:14px;line-height:1.7;margin:14px 0 0">
          <strong>Conversion so far:</strong> ${r.priorConverted} of ${r.priorNudged} members nudged 3+ days ago have since RSVP'd (<strong>${rate}%</strong>).
        </p>
        ${arms}
        <p style="color:#9ca3af;font-size:12px;margin-top:16px">Automated — Smileys first-RSVP nudge cron.</p>
      </div>`,
  })
}

export async function sendListingAlertEmail(
  to: string,
  name: string,
  categoryLabel: string,
  listing: { title: string; description: string },
) {
  const url = `${APP_URL}/board`
  const unsub = `${APP_URL}/settings`
  const excerpt = listing.description.length > 120 ? listing.description.slice(0, 120) + '…' : listing.description
  await getResend().emails.send({
    from: FROM, to,
    subject: safeSubject(`New ${categoryLabel} listing: ${listing.title}`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:36px">😊</span>
          <p style="color:#6b7280;font-size:12px;margin:4px 0 0;letter-spacing:0.08em;text-transform:uppercase">Smileys Community Board</p>
        </div>
        <p style="margin:0 0 12px;color:#374151;font-size:14px">Hey ${esc(name)},</p>
        <p style="margin:0 0 20px;color:#374151;font-size:14px">A new <strong>${esc(categoryLabel)}</strong> listing was just posted:</p>
        <div style="background:#f9fafb;border-radius:12px;padding:16px 20px;margin-bottom:24px;border-left:3px solid #f59e0b">
          <p style="font-size:15px;font-weight:700;color:#111827;margin:0 0 6px">${esc(listing.title)}</p>
          <p style="font-size:13px;color:#6b7280;margin:0;line-height:1.5">${esc(excerpt)}</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:14px;padding:13px 24px;border-radius:10px;text-decoration:none;margin-bottom:24px">
          View on Community Board →
        </a>
        <p style="color:#9ca3af;font-size:11px;text-align:center;line-height:1.6">
          You're getting this because you subscribed to ${esc(categoryLabel)} alerts.<br>
          <a href="${unsub}" style="color:#9ca3af">Manage your alerts</a>
        </p>
      </div>
    `,
  })
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Build one recipient's newsletter email payload (no send). Shared by the
// single send (test) and the batch send. bodyHtml is admin-authored and
// intentionally not escaped; subject is sanitised to block header injection.
// NB: no `tags` — Resend's Batch API rejects per-email tags, and this must be
// identical between single + batch so both render the same email.
function buildNewsletterPayload(userId: string, email: string, name: string, subject: string, bodyHtml: string, newsletterId?: string, preheader?: string) {
  const unsub     = unsubscribeUrl(userId, newsletterId)
  const firstName = esc(name.split(' ')[0])
  // Hidden preview line inboxes show after the subject; zero-width padding
  // stops clients from pulling visible body text in after it.
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>`
    : ''
  return {
    from:    FROM,
    to:      email,
    subject: safeSubject(subject),
    html: `
      ${preheaderHtml}
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px 32px;border:1px solid #e5e7eb">
        <div style="margin-bottom:28px">
          <p style="margin:0;font-size:14px;color:#6b7280;white-space:nowrap"><span style="font-size:26px;vertical-align:-5px">😊</span>&nbsp;<strong style="color:#374151">Smileys&nbsp;Community</strong>&nbsp;·&nbsp;Istanbul</p>
        </div>
        <p style="margin:0 0 16px;color:#374151;font-size:14px">Hi ${firstName},</p>
        <div style="color:#374151;font-size:14px;line-height:1.6">${bodyHtml}</div>
        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f3f4f6">
          <a href="${APP_URL}/events"
            style="display:inline-block;background:#f59e0b;color:#fff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
            Browse upcoming events →
          </a>
        </div>
        <p style="margin-top:24px;font-size:13px">
          <a href="https://www.instagram.com/smileys.community" style="color:#b45309;font-weight:600;text-decoration:none">Instagram</a>
          <span style="color:#d1d5db">·</span>
          <a href="https://www.whatsapp.com/channel/0029VaCKyc29hXF4fZuOod1K" style="color:#b45309;font-weight:600;text-decoration:none">WhatsApp channel</a>
          <span style="color:#d1d5db">·</span>
          <a href="https://linkedin.com/company/smileys-community" style="color:#b45309;font-weight:600;text-decoration:none">LinkedIn</a>
          <span style="color:#d1d5db">·</span>
          <a href="https://www.facebook.com/aswistanbul/" style="color:#b45309;font-weight:600;text-decoration:none">Facebook</a>
        </p>
        <p style="color:#9ca3af;font-size:11px;margin-top:16px;line-height:1.5">
          You're receiving this because you're a member of Smileys Community.<br>
          <a href="${unsub}" style="color:#9ca3af">Unsubscribe from newsletters</a>
        </p>
      </div>
    `,
    text:    `Hi ${firstName},\n\n${stripHtml(bodyHtml)}\n\nBrowse upcoming events: ${APP_URL}/events\n\nUnsubscribe: ${unsub}`,
    headers: { 'List-Unsubscribe': unsub },
  }
}

// Single newsletter send (used by the "send test to me" path). Returns the
// Resend email ID for webhook attribution.
export async function sendNewsletterEmail(
  userId: string, email: string, name: string, subject: string, bodyHtml: string, newsletterId?: string,
  preheader?: string,
): Promise<string> {
  const { data, error } = await getResend().emails.send(buildNewsletterPayload(userId, email, name, subject, bodyHtml, newsletterId, preheader))
  if (error || !data?.id) throw error ?? new Error('Resend returned no email ID')
  return data.id
}

// Bulk newsletter send via Resend's Batch API — up to 100 emails per request.
// This is the fix for the rate-limit failures: the old path fired ~50
// concurrent single sends per second against Resend's ~2 req/s limit, so most
// got 429'd with no retry. 1,058 emails now go out in ~11 batch requests.
// Returns per-recipient outcomes so the caller can log failures + Resend IDs.
export async function sendNewsletterBatch(
  recipients: { id: string; email: string; name: string }[],
  subject: string,
  bodyHtml: string,
  newsletterId: string,
  preheader?: string,
): Promise<{ sent: number; resendLogs: { newsletterId: string; resendId: string }[]; failed: { email: string; error: string }[] }> {
  const CHUNK = 100
  const resendLogs: { newsletterId: string; resendId: string }[] = []
  const failed: { email: string; error: string }[] = []
  let sent = 0

  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk    = recipients.slice(i, i + CHUNK)
    const payloads = chunk.map(r => buildNewsletterPayload(r.id, r.email, r.name, subject, bodyHtml, newsletterId, preheader))
    try {
      const { data, error } = await getResend().batch.send(payloads)
      if (error) throw error
      // Resend returns { data: [{ id }, …] } aligned with the payload order.
      const ids = ((data as { data?: { id: string }[] } | undefined)?.data ?? []) as { id: string }[]
      chunk.forEach((r, j) => {
        const id = ids[j]?.id
        if (id) { sent++; resendLogs.push({ newsletterId, resendId: id }) }
        else    { failed.push({ email: r.email, error: 'Resend returned no id for this recipient' }) }
      })
    } catch (e) {
      // Whole-batch error (auth / rate / validation) — record every recipient
      // in the chunk. serializeError keeps the real message (not [object Object]).
      const msg = serializeError(e)
      chunk.forEach(r => failed.push({ email: r.email, error: msg }))
    }
    // Small gap between batch requests — 11 requests for ~1k emails is already
    // far under the rate limit, but stay polite.
    if (i + CHUNK < recipients.length) await new Promise(res => setTimeout(res, 400))
  }
  return { sent, resendLogs, failed }
}

export async function sendEventReminderEmail(
  userId: string,
  email: string,
  name: string,
  eventTitle: string,
  eventEmoji: string,
  eventDate: string,
  eventLocation: string,
  eventId: string,
) {
  const unsub     = unsubscribeUrl(userId)
  const firstName = name.split(' ')[0]
  const url       = `${APP_URL}/events/${eventId}`
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`Reminder: ${eventTitle} ${eventEmoji} is coming up!`),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">${esc(eventEmoji)}</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">Don't forget, ${esc(firstName)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0"><strong>${esc(eventTitle)}</strong> is coming up soon.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0"><strong>📅</strong> ${esc(eventDate)}</p>
          <p style="color:#92400e;font-size:14px;margin:6px 0 0"><strong>📍</strong> ${esc(eventLocation)}</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          View event →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">If your plans change, please cancel your spot so others can join.</p>
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:20px">
          <a href="${unsub}" style="color:#9ca3af">Unsubscribe from event reminders</a>
        </p>
      </div>
    `,
    tags: [{ name: 'type', value: 'event_reminder' }],
  })
}

export async function sendNoShowEmail(
  userId: string,
  email: string,
  name: string,
  eventTitle: string,
  eventEmoji: string,
  eventId: string,
) {
  const unsub     = unsubscribeUrl(userId)
  const firstName = name.split(' ')[0]
  const url       = `${APP_URL}/events`
  await getResend().emails.send({
    from: FROM, to: email,
    subject: safeSubject(`We missed you at ${eventTitle} ${eventEmoji}`),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:28px">
          <span style="font-size:40px">${esc(eventEmoji)}</span>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:8px 0 4px">We missed you, ${esc(firstName)}!</h1>
          <p style="color:#6b7280;font-size:14px;margin:0">You were registered for <strong>${esc(eventTitle)}</strong> but we didn't see you there.</p>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="color:#92400e;font-size:14px;margin:0">No worries — life happens! Next time, if you can't make it, please cancel your spot so someone on the waitlist can join. It takes 10 seconds and makes a big difference.</p>
        </div>
        <a href="${url}" style="display:block;text-align:center;background:#f59e0b;color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;margin-bottom:16px">
          Browse upcoming events →
        </a>
        <p style="color:#9ca3af;font-size:12px;text-align:center">Hope to see you at the next one 😊</p>
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:20px">
          <a href="${unsub}" style="color:#9ca3af">Unsubscribe from event reminders</a>
        </p>
      </div>
    `,
    tags: [{ name: 'type', value: 'no_show' }],
  })
}
