import Link from 'next/link'
import { getCommunityStats, approx, eventsStat } from '@/lib/communityStats'
import { prisma } from '@/lib/prisma'
import { ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { APP_URL } from '@/lib/env'
import AdvertiseFormClient from './AdvertiseFormClient'
import { loadContent } from '@/lib/content'

export const revalidate = 3600

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Advertise with Smileys',
  eyebrow: "Reach Istanbul's Internationals",
  cta:     'Get in touch',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/advertise` },
  title: 'Advertise with Smileys — Reach Istanbul\'s Most Engaged Internationals',
  description: 'Advertise with Smileys to reach a curated community of expats and global professionals actively building their life in Istanbul.',
  openGraph: {
    title: 'Advertise with Smileys Community',
    description: 'Reach vetted, active English-speaking internationals living in Istanbul through Smileys events, newsletter, and clubs.',
    url: `${APP_URL}/advertise`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Advertise with Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Advertise with Smileys Community',
    description: 'Reach vetted, active English-speaking internationals living in Istanbul through Smileys events, newsletter, and clubs.',
    images: [ogImage],
  },
}

const WHY = [
  {
    icon: '🎯',
    title: 'A highly targeted audience',
    body: "Every member is personally reviewed. You're not buying impressions from a random crowd — you're reaching vetted, active, English-speaking internationals living in Istanbul.",
  },
  {
    icon: '💳',
    title: 'People who go out',
    body: "Our members are relocating professionals, entrepreneurs, and globally mobile creatives. They join to discover the city in person — the restaurants, venues and activities where your brand can be part of the evening.",
  },
  {
    icon: '🤝',
    title: 'Trusted context',
    body: "Recommendations that come through Smileys carry community trust, so we keep paid and editorial apart: sponsored placements are always labelled, and our editorial coverage is independent and not for sale.",
  },
  {
    icon: '📍',
    title: 'Istanbul-first',
    // The share is measured on the page (it said 80%; it was 98%).
    body: "Minimal wasted reach. {ISTANBUL_SHARE} of our members are based in Istanbul, making Smileys one of the most geographically precise channels in the city.",
  },
]

const FORMATS = [
  {
    key: 'event_sponsorship',
    icon: '🎉',
    title: 'Event Sponsorship',
    features: [
      // It promised 30–80 attendees; the median event in the last 90 days
      // had 7, and the largest 68 (2026-09-29). Say what the rooms are.
      'Brand visibility at a curated event — from small tables to our biggest nights of 30–70 people',
      'Logo on event page and member communications',
      'Optional branded activity or product sampling',
      'Post-event recap in community newsletter',
    ],
    highlight: false,
  },
  {
    key: 'newsletter',
    icon: '📧',
    title: 'Newsletter Feature',
    features: [
      'Dedicated section in our weekly member newsletter',
      'Custom copy written by the Smileys team',
      'Direct link to your offer, page, or booking',
      // No open rate: the database records sends, not opens, and nobody
      // confirmed the 45% it claimed (2026-09-29).
    ],
    highlight: false,
  },
  {
    key: 'club_partnership',
    icon: '⬡',
    title: 'Club Partnership',
    features: [
      'Named partner of a specific interest club',
      'Recurring visibility across all club events',
      'Inclusion in club page and member messaging',
      'First right of refusal on club event sponsorship',
    ],
    highlight: false,
  },
  {
    key: 'branded_event',
    icon: '✦',
    title: 'Branded Event',
    features: [
      'Co-create a bespoke event with the Smileys team',
      'Full venue, curation, and guest-list management',
      'Exclusive branding throughout the experience',
      'Ideal for product launches and brand activations',
    ],
    highlight: false,
  },
]

// The three ways in, in plain words. Each points at the concrete formats below
// (same four the form and admin inbox already use), so there is one vocabulary.
const OFFERS = [
  { icon: '📣', title: 'Promote an event', body: 'Sponsored content, app visibility and agreed social promotion for an event your audience should know about.', formats: 'Event Sponsorship · Newsletter Feature' },
  { icon: '🔁', title: 'Become a monthly partner', body: 'Recurring campaigns for relevant events or services, planned together month by month.', formats: 'Club Partnership' },
  { icon: '🥂', title: 'Sponsor a Smileys experience', body: 'Support a language exchange, networking evening or another community activity members already enjoy.', formats: 'Event Sponsorship · Branded Event' },
]

const SECTORS = [
  'Restaurants & dining', 'Hotels & accommodation', 'Real estate & relocation',
  'Language schools', 'Fitness & wellness', 'Fashion & lifestyle',
  'Finance & legal services', 'Tech & startups', 'Travel & tours',
]

export default async function AdvertisePage() {
  const c   = loadContent()
  const adv = c.advertise ?? {}
  // Optional rate card, editable from /admin/content without a deploy.
  // Keyed by format key with display strings, e.g.
  // { "newsletter": "from ₺7.500" }. Formats without a price show
  // "Custom pricing" so we never publish a number nobody set.
  const PRICES: Record<string, string> = adv.prices ?? {}
  // Measured, like /about, /why and /get-involved: the admin rows put
  // "4,000+ total WhatsApp reach" and "1,000+ events since 2023" (318 on the
  // platform) in front of people deciding what to buy (2026-09-29).
  const [s, nationalityRows, cityCounts, hostRows] = await Promise.all([
    getCommunityStats(),
    prisma.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT lower(trim(nationality)))::int AS n FROM users WHERE status = 'approved' AND coalesce(trim(nationality), '') <> ''`,
    prisma.user.groupBy({ by: ['cityId'], where: ACTIVATED_MEMBER_WHERE, _count: { _all: true } }),
    prisma.clubMembership.findMany({ where: { role: 'host', status: 'approved', club: { isActive: true } }, distinct: ['userId'], select: { userId: true } }),
  ])
  const istanbul = await prisma.city.findUnique({ where: { slug: DEFAULT_CITY_SLUG }, select: { id: true } })
  const totalMembers   = cityCounts.reduce((n, r) => n + r._count._all, 0)
  const istanbulShare  = totalMembers ? Math.floor(100 * (cityCounts.find(r => r.cityId === istanbul?.id)?._count._all ?? 0) / totalMembers) : 0
  const nationalities  = approx(nationalityRows[0]?.n ?? 0)
  const hosts          = approx(hostRows.length)
  const STATS = [
    { value: approx(s.members), label: 'Members' },
    eventsStat(s.events),
    { value: approx(s.clubs),   label: 'Active clubs' },
    { value: nationalities,     label: 'Nationalities' },
  ]
  const asOf = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const why = WHY.map(w => ({ ...w, body: w.body.replace('{ISTANBUL_SHARE}', `${istanbulShare}%`) }))
  return (
    <div className="min-h-screen bg-warm">

      {/* Hero — same shape as /partner-with-us so the two read as a pair. */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-4">Advertise with Smileys</p>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-5">
            {adv.headline?.trim() || "Reach Istanbul's most engaged internationals"}
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto mb-8">
            {adv.subtitle?.trim() || "Smileys is a curated community of expats and global professionals actively building their life in Istanbul. Advertise where trust is already built in."}
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <a href="#formats"
              className="px-7 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm text-center transition-colors">
              See advertising options
            </a>
            <a href="#contact"
              className="px-7 py-3.5 rounded-xl border border-gray-300 text-gray-800 font-semibold text-sm text-center hover:bg-gray-50 transition-colors">
              Get in touch
            </a>
          </div>
          <p className="mt-6 text-sm text-gray-600 max-w-2xl mx-auto">
            Promoting an event and after editorial coverage rather than paid placement? That is a separate,
            independent track — see <Link href="/partner-with-us" className="text-amber-700 font-medium underline">Partner with us</Link>.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-14">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <p className="text-xs text-gray-500 mb-4">Rounded figures, measured from our own records on {asOf}.</p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {STATS.map(st => (
              <div key={st.label} className="flex flex-col-reverse gap-1 rounded-xl bg-amber-50/60 p-4">
                <dt className="text-xs font-bold uppercase tracking-wide text-amber-700">{st.label}</dt>
                <dd className="text-3xl font-extrabold text-gray-900">{st.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Why advertise */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Why advertise with Smileys?</h2>
        <p className="text-gray-600 max-w-2xl mb-8">
          Quantity is easy. Quality is rare. Our community is small by design — and that&apos;s the point.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {why.map(w => (
            <div key={w.title} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div aria-hidden="true" className="text-2xl mb-2">{w.icon}</div>
              <h3 className="font-bold text-gray-900 mb-1">{w.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Audience */}
      <section className="bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900 mb-6">Our audience at a glance</h2>
              <div className="space-y-4">
                {[
                  { label: 'Languages',  value: `English-first, ${nationalities} nationalities` },
                  { label: 'Profile',    value: 'Professionals, entrepreneurs, creatives'     },
                  { label: 'Location',   value: `${istanbulShare}% Istanbul-based`             },
                  // No per-member activity claim: nothing measured backs one
                  // (a media buyer would do the math), so say why members join.
                  { label: 'Engagement', value: 'Members join to meet people in person, at events, clubs and hangouts' },
                  { label: 'Hosts',      value: `${hosts} club hosts running events and activities` },
                  { label: 'Membership', value: 'Application-only, personally reviewed'       },
                ].map(r => (
                  <div key={r.label} className="flex gap-4 text-sm border-b border-gray-50 pb-4">
                    <span className="w-28 shrink-0 font-semibold text-gray-500">{r.label}</span>
                    <span className="text-gray-700">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              {/* "we work with" implied clients; none have bought yet. */}
              <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Industries that fit our members</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {SECTORS.map(s => (
                  <span key={s} className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-xs font-semibold">
                    {s}
                  </span>
                ))}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                Our members are actively exploring Istanbul — restaurants, fitness studios,
                co-working spaces, real estate. They&apos;re your most receptive audience.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Proof — no partner logos yet (partners table is empty), so the
          strongest available evidence is the rooms themselves: real event
          photos, member-consent-sensitive, swap via public/images/advertise. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">The rooms your brand joins</h2>
        <p className="text-gray-600 max-w-2xl mb-8">
          Photos from our events: the kind of rooms your brand would be part of, from small tables to our biggest nights.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(n => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={n} src={`/app/images/advertise/event-${n}.jpg`}
              alt="A Smileys community event"
              loading="lazy"
              className="aspect-[3/4] w-full object-cover rounded-2xl border border-gray-100" />
          ))}
        </div>
      </section>

      {/* Three ways to work with us — the headline offers; formats below are the detail. */}
      <section id="offers" className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Three ways to work with us</h2>
        <p className="text-gray-600 max-w-2xl mb-8">
          Scope and terms are agreed individually after a conversation. Sponsored content is always labelled as such.
        </p>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 list-none p-0">
          {OFFERS.map(o => (
            <li key={o.title} className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
              <div aria-hidden="true" className="text-2xl mb-2">{o.icon}</div>
              <h3 className="font-bold text-gray-900 mb-1">{o.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-3">{o.body}</p>
              <p className="mt-auto text-xs text-gray-500">Formats: {o.formats}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6">
          <a href="#contact" className="inline-block px-7 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm text-center transition-colors">Discuss a partnership</a>
        </p>
      </section>

      {/* Formats */}
      <section id="formats" className="bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Advertising formats</h2>
          <p className="text-gray-600 max-w-2xl mb-8">
            Each format is designed to feel native to the community — not intrusive. No banner blindness, no ignored ads.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FORMATS.map(f => (
              <div key={f.title} className={`rounded-2xl border p-5 flex flex-col ${
                f.highlight ? 'bg-amber-50 border-amber-200' : 'bg-warm border-gray-100'
              }`}>
                {/* No popularity badge: nothing has been sold yet. */}
                <div aria-hidden="true" className="text-2xl mb-2">{f.icon}</div>
                <h3 className="font-bold text-gray-900 mb-3">{f.title}</h3>
                <ul className="space-y-2 mb-4">
                  {f.features.map(feat => (
                    <li key={feat} className="flex items-start gap-2 text-sm text-gray-600">
                      <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500">✓</span>
                      {feat}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto text-sm font-bold text-gray-900">
                  {PRICES[f.key] ?? 'Custom pricing'}
                </div>
                <a href="#contact"
                  className="mt-3 block text-center py-2.5 rounded-xl border border-gray-300 bg-white text-gray-800 text-sm font-semibold hover:bg-gray-50 transition-colors">
                  Inquire
                </a>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-600 mt-6">
            Pricing is tailored to your goals and format. Get in touch and we&apos;ll put together a proposal.
          </p>
        </div>
      </section>

      {/* Contact form — the page ends here, like /partner-with-us. The global
          footer's member CTA band is suppressed on this page (see
          components/Footer.tsx): an advertiser page must not end by pitching
          membership. */}
      <section id="contact" className="max-w-2xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Get in touch</h2>
        <p className="text-gray-600 mb-6">
          Tell us about your brand and what you&apos;re looking to achieve.
          We read every inquiry and reply by email.
        </p>
        <AdvertiseFormClient />
        <p className="text-sm text-gray-600 mt-6 text-center">
          Promoting an event and want editorial coverage? See <Link href="/partner-with-us" className="text-amber-700 font-medium underline">Partner with us</Link>.
          Want to attend events as a member? <Link href="/apply" className="text-amber-700 font-medium underline">Apply to join</Link>.
        </p>
      </section>

    </div>
  )
}
