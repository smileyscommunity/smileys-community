// The WhatsApp message an admin sends a member who was approved but never set
// a password (admin Retention > Not activated). Sent by hand from the admin's
// own WhatsApp, not by the server: there is no WhatsApp service, and an
// unofficial bot sending to people who never messaged us risks the number
// being banned. If this lifts activation, the automated version belongs on
// WhatsApp's official Business API, with this text as its template.
//
// Pure (no prisma, no env) so it can be unit-tested and reused by that API.

import { whatsappUrl } from '@/lib/data'
import { DEFAULT_TZ } from '@/lib/cityTime'

// Past this, "a little while ago" undersells it, so the message names the
// month instead ("back in June"), with the year once it is a different one,
// read in the member's city timezone so a late-evening approval on the last
// of the month is not named after the next one.
export const NAME_THE_MONTH_AFTER_DAYS = 60

/** "a little while ago" for a recent approval, "back in June" (or "back in December 2025") for an older one. */
export function approvedWhen(approvedAt: Date, now: Date = new Date(), timeZone: string = DEFAULT_TZ): string {
  const days = (now.getTime() - approvedAt.getTime()) / 86_400_000
  if (days <= NAME_THE_MONTH_AFTER_DAYS) return 'a little while ago'
  const sameYear = approvedAt.getUTCFullYear() === now.getUTCFullYear()
  const month = approvedAt.toLocaleDateString('en-GB', {
    month: 'long', timeZone, ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `back in ${month}`
}

export function activationWhatsAppMessage(
  firstName: string | null | undefined,
  activationLink: string,
  approvedAt: Date,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TZ,
): string {
  const name = firstName?.trim() || 'there'
  return [
    `Hi ${name}, it's Nate from Smileys 👋 You were approved ${approvedWhen(approvedAt, now, timeZone)}, but your account isn't set up yet. Here's a fresh link to set your password, valid for 7 days: ${activationLink}`,
    'Any questions, just reply here. See you at a table soon!',
  ].join('\n\n')
}

/** wa.me link that opens a chat with the member and the message filled in, or null without a usable number. */
export function activationWhatsAppUrl(
  phone: string | null | undefined,
  nationality: string | null | undefined,
  message: string,
): string | null {
  const base = whatsappUrl(phone, nationality)
  return base ? `${base}?text=${encodeURIComponent(message)}` : null
}
