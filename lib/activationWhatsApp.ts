// The WhatsApp message an admin sends a member who was approved but never set
// a password (admin Retention > Not activated). Sent by hand from the admin's
// own WhatsApp, not by the server: there is no WhatsApp service, and an
// unofficial bot sending to people who never messaged us risks the number
// being banned. If this lifts activation, the automated version belongs on
// WhatsApp's official Business API, with this text as its template.
//
// Pure (no prisma, no env) so it can be unit-tested and reused by that API.

import { whatsappUrl } from '@/lib/data'

export function activationWhatsAppMessage(firstName: string | null | undefined, activationLink: string): string {
  const name = firstName?.trim() || 'there'
  return [
    `Hi ${name}, it's Nate from Smileys 👋 You were approved a little while ago, but your account isn't set up yet. Here's a fresh link to set your password, valid for 7 days: ${activationLink}`,
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
