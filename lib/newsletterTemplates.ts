// Ready-made newsletters the admin composer can load in one tap (subject,
// body, audience), then edit and send as usual. Loading one sends nothing.
//
// Bodies leave out the greeting and the events button: the newsletter
// wrapper adds "Hi {first name}," above and "Browse upcoming events" below
// (lib/email buildNewsletterPayload). Replies go to the sending address.
//
// Pure data so the client page can import it.

import type { Segment } from '@/lib/newsletterSegments'

export interface NewsletterTemplate {
  id: string
  name: string
  subject: string
  bodyHtml: string
  segment: Segment
}

const p = (text: string) => `<p>${text}</p>`

export const NEWSLETTER_TEMPLATES: NewsletterTemplate[] = [
  {
    // For members who set up their account but never came to an event. A
    // personal ask for a reply, not an event pick: the automated first-RSVP
    // email (retired 2026-10-05) recommended an event and moved nothing.
    // Send to the 7–60 day batch first, then switch the audience to 60d+.
    id: 'first-event-seat',
    name: 'Never attended: "Can I save you a seat?"',
    subject: 'Can I save you a seat?',
    segment: 'never_attended_new',
    bodyHtml: [
      p("It's Nate, the founder of Smileys. You've been a member for a little while, but we haven't met at an event yet, and I'd like to change that."),
      p("Walking into a room of strangers is the hardest part of being new in a city. So here's an easier way in: just reply to this email and tell me what you're into, whether that's food, hiking, languages, or a quiet drink. I'll point you to one event that fits and let the host know you're coming, so someone will be looking out for you when you arrive."),
      p("If now isn't the right time, no problem at all. Your membership isn't going anywhere."),
      p('See you soon,<br />Nate'),
    ].join(''),
  },
]
