import Link from 'next/link'
import { headers } from 'next/headers'
import { isValidElement, type ReactNode } from 'react'
import { APP_URL } from '@/lib/env'
import { loadContent } from '@/lib/content'

export const revalidate = 3600

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Frequently Asked Questions',
  eyebrow: 'Smileys Community Help Centre',
  cta:     'Get answers',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/faq` },
  title: 'FAQ — Smileys Community Help Centre',
  description: 'Everything you need to know about Smileys — membership, events, clubs, applications, and more.',
  openGraph: {
    title: 'Smileys Community FAQ',
    description: 'Everything you need to know about joining and using Smileys Community in Istanbul.',
    url: `${APP_URL}/faq`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Smileys Community FAQ' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smileys Community FAQ',
    description: 'Everything you need to know about joining and using Smileys Community in Istanbul.',
    images: [ogImage],
  },
}

interface FAQ  { q: string; a: React.ReactNode }
interface Section { id: string; icon: string; title: string; faqs: FAQ[] }

// FAQPage schema needs a plain-text answer, but a few `a` values are JSX
// (e.g. "<span>Fill in the form at <Link>...</Link>.</span>") for in-page
// links. Walk the element tree and concatenate text without rendering
// anything — safe for both a plain string and these simple span/Link shapes.
function faqAnswerText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(faqAnswerText).join('')
  if (isValidElement(node)) return faqAnswerText((node.props as { children?: ReactNode }).children)
  return ''
}

const SECTIONS: Section[] = [
  {
    id: 'getting-started', icon: '🚀', title: 'Getting Started',
    faqs: [
      {
        q: 'What is Smileys Community?',
        a: 'Smileys is an application-based social community in Istanbul. We bring together expats, locals, and globally-minded people through curated events, interest-based clubs, and genuine connections — across neighborhoods on both sides of the city.',
      },
      {
        q: 'Who can join?',
        a: 'Anyone living in or frequently visiting Istanbul who is open-minded, social, and looking to build real connections. We welcome all nationalities, backgrounds, and lifestyles. The one requirement is that you apply and are approved by our team.',
      },
      {
        q: 'Is Smileys free to join?',
        a: 'Applying is completely free. Some events have a ticket price to cover venue or activity costs, but membership itself has no monthly fee.',
      },
      {
        q: 'How long does approval take?',
        a: 'Most applications are reviewed within 2–5 business days. You will receive an email once a decision has been made. During busy periods it may take a little longer.',
      },
    ],
  },
  {
    id: 'applications', icon: '📋', title: 'Applications',
    faqs: [
      {
        q: 'How do I apply?',
        a: <span>Fill in the application form at <Link href="/apply" className="text-amber-600 font-medium hover:underline">smileyscommunity.com/apply</Link>. It takes about 5 minutes. Tell us about yourself, why you are in Istanbul, and what you are looking for in a community.</span>,
      },
      {
        q: 'What happens after I apply?',
        a: 'Our team personally reviews every application. If approved, you will receive a welcome email with a link to activate your account. If we need more information, we may reach out before making a decision.',
      },
      {
        q: 'Why was my application declined?',
        a: 'We review each application holistically. Common reasons include incomplete answers, a profile that does not seem like a good fit for the current community dynamic, or capacity limits. We do not share specific reasons to protect the integrity of the process.',
      },
      {
        q: 'Can I reapply after being declined?',
        a: 'Yes. You are welcome to reapply after 3 months. If your circumstances have changed or you would like to provide more context, a stronger application will always be considered.',
      },
      {
        q: 'My account was suspended. How do I appeal?',
        a: <span>Submit an appeal at <Link href="/appeal" className="text-amber-600 font-medium hover:underline">smileyscommunity.com/appeal</Link>. Explain your situation and our team will review it. Appeals are typically resolved within 5 business days.</span>,
      },
    ],
  },
  {
    id: 'events', icon: '🎉', title: 'Events',
    faqs: [
      {
        q: 'How do I RSVP to an event?',
        a: <span>Browse upcoming events at <Link href="/events" className="text-amber-600 font-medium hover:underline">smileyscommunity.com/events</Link> and click Join on any event that interests you. If the event requires approval, your request will be reviewed by the host.</span>,
      },
      {
        q: 'What does "approval required" mean?',
        a: 'Some events are curated and require your request to be manually approved before your spot is confirmed. You will receive a notification once the host reviews your request. Your spot is only confirmed when you see "Approved" status.',
      },
      {
        q: 'What is the waitlist?',
        a: 'When an event is full, you will automatically be added to the waitlist. If a spot opens up because someone cancels, the first person on the waitlist is automatically promoted and notified.',
      },
      {
        q: 'How do I cancel my RSVP?',
        a: 'Go to the event page and click Cancel. Please cancel as early as possible so your spot can go to someone on the waitlist. Repeated last-minute cancellations may affect your standing.',
      },
      {
        q: 'Are events gender-balanced?',
        a: 'Many Smileys events use gender balancing to create a comfortable social dynamic. When spots for one gender are full, additional applicants are added to the waitlist while spots for the other gender may still be available.',
      },
      {
        q: 'Can I bring a guest?',
        a: 'Smileys events are for members only unless the event listing specifically states that guests are welcome. This keeps the community feel intact and ensures every attendee has been vetted.',
      },
      {
        q: 'Do I need to pay to attend events?',
        a: 'Some events are free, others have a ticket price to cover the venue, food, or activity. The price is always shown clearly on the event page before you RSVP.',
      },
    ],
  },
  {
    id: 'clubs', icon: '🏛️', title: 'Clubs',
    faqs: [
      {
        q: 'What are clubs?',
        a: 'Clubs are ongoing interest groups within Smileys — think hiking, photography, dining, language exchange, and more. Each club has its own wall for discussion, a host who organises activities, and a dedicated group of members.',
      },
      {
        q: 'How do I join a club?',
        a: <span>Browse clubs at <Link href="/clubs" className="text-amber-600 font-medium hover:underline">smileyscommunity.com/clubs</Link> and click Join. Some clubs are open, others require host approval.</span>,
      },
      {
        q: 'Can I start my own club?',
        a: 'Yes. If you have a passion or hobby you would like to build a group around, reach out to us via the Contact page. We will review the idea and set you up as a host if it is a good fit for the community.',
      },
      {
        q: 'What can I post on a club wall?',
        a: 'Club walls are for sharing updates, organising meetups, asking questions, and keeping the conversation going between events. Polls, pinned announcements, and reactions are all supported.',
      },
    ],
  },
  {
    id: 'account', icon: '👤', title: 'Account & Profile',
    faqs: [
      {
        q: 'How do I update my profile?',
        a: <span>Go to <Link href="/profile" className="text-amber-600 font-medium hover:underline">smileyscommunity.com/profile</Link> to update your photo, bio, neighborhood, interests, and contact details.</span>,
      },
      {
        q: 'How do I change my password?',
        a: 'Go to your Profile page and scroll to the Change password section. You will need to enter your current password to set a new one.',
      },
      {
        q: 'How do I change my email address?',
        a: 'Go to your Profile page, find the Email address section, enter your new email and confirm with your current password. A verification email will be sent to the new address.',
      },
      {
        q: 'I forgot my password. What do I do?',
        a: <span>Go to <Link href="/forgot-password" className="text-amber-600 font-medium hover:underline">smileyscommunity.com/forgot-password</Link> and enter your email. We will send you a reset link valid for 24 hours.</span>,
      },
      {
        q: 'How do I delete my account?',
        a: 'Please contact us via the Contact page with your request. Account deletion is permanent and removes all your data, event history, and club memberships.',
      },
    ],
  },
  {
    id: 'safety', icon: '🛡️', title: 'Community & Safety',
    faqs: [
      {
        q: 'What are the community guidelines?',
        a: 'Smileys is built on respect, inclusivity, and genuine connection. We do not tolerate harassment, discrimination, spamming, or any behaviour that makes others feel unsafe or unwelcome. Violation of these principles can result in removal from the community.',
      },
      {
        q: 'How do I report a member?',
        a: 'You can report a member from their profile page. Select the reason, add any relevant context, and our moderation team will review it promptly. All reports are confidential.',
      },
      {
        q: 'Is my personal information safe?',
        a: <span>Yes. We never sell your data to third parties. Your profile is only visible to other verified Smileys members. Read our full <Link href="/privacy" className="text-amber-600 font-medium hover:underline">Privacy Policy</Link> for details.</span>,
      },
    ],
  },
]

export default async function FAQPage() {
  const c = loadContent()
  const sections: Section[] = c.faq?.length > 0
    ? c.faq.map((s: any) => ({
        id:    s.id,
        icon:  s.icon,
        title: s.title,
        faqs:  s.items.map((item: any) => ({ q: item.q, a: item.a })),
      }))
    : SECTIONS

  // FAQPage rich results — every Q&A on the page, flattened across sections.
  // Read the per-request CSP nonce set by middleware so the <script> isn't
  // blocked under 'strict-dynamic' (same pattern as the handbook article /
  // event detail JSON-LD).
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type':    'FAQPage',
    mainEntity: sections.flatMap(s => s.faqs.map(faq => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faqAnswerText(faq.a) },
    }))),
  }

  return (
    <main className="bg-gray-50 min-h-screen">
      <script
        type="application/ld+json"
        nonce={nonce}
        // JSON.stringify doesn't escape `<`, so a literal `</script>` in any
        // interpolated value would break out of this tag — escape `<` plus
        // the unicode line separators (same guard as the other JSON-LD blocks).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029'),
        }}
      />

      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-6">
            ❓ Help Centre
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
            Frequently asked questions
          </h1>
          <p className="text-base text-gray-600 max-w-lg">
            Everything you need to know about Smileys — membership, events, clubs, and more.
          </p>
        </div>

        {/* Category pills */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
          <div className="flex flex-wrap gap-2">
            {sections.map(s => (
              <a key={s.id} href={`#${s.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gray-50 border border-gray-200 text-sm font-medium text-gray-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-all">
                <span>{s.icon}</span>
                {s.title}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-16">
        {sections.map(s => (
          <section key={s.id} id={s.id}>
            {/* Section header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl shrink-0">
                {s.icon}
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900">{s.title}</h2>
            </div>

            {/* Q&A grid */}
            <div className="grid sm:grid-cols-2 gap-4">
              {s.faqs.map((faq, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:border-amber-200 transition-colors">
                  <p className="text-sm font-bold text-gray-900 mb-2.5 leading-snug">{faq.q}</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* CTA */}
        <div className="bg-amber-500 rounded-2xl p-10 text-center">
          <div className="text-3xl mb-3">💬</div>
          <h3 className="text-2xl font-extrabold text-white mb-2">Still have questions?</h3>
          <p className="text-amber-100 text-sm mb-6 max-w-sm mx-auto">
            Our team is happy to help — we will get back to you within 1–2 business days.
          </p>
          <Link href="/contact" className="btn-white !px-7 !py-3 !text-sm">Contact us</Link>
        </div>
      </div>

    </main>
  )
}
