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
  description: 'Partner with Smileys to reach a curated community of expats and global professionals actively building their life in Istanbul.',
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
    title: 'High spending power',
    body: "Our members are relocating professionals, entrepreneurs, and globally mobile creatives. They're actively discovering the city — and actively spending on it.",
  },
  {
    icon: '🤝',
    title: 'Trusted context',
    body: "Recommendations that come through Smileys carry community trust. Our members engage with our content, not just scroll past it.",
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
  const why = WHY.map(w => ({ ...w, body: w.body.replace('{ISTANBUL_SHARE}', `${istanbulShare}%`) }))
  return (
    <div>

      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-6">
            <span aria-hidden="true">✦</span> Partner with Smileys
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-tight mb-6">
            {adv.headline?.trim() || "Reach Istanbul's most engaged internationals"}
          </h1>
          <p className="text-base text-gray-600 max-w-2xl leading-relaxed">
            {adv.subtitle?.trim() || "Smileys is a curated community of expats and global professionals actively building their life in Istanbul. Advertise where trust is already built in."}
          </p>
          <div className="mt-10 flex items-center gap-4 flex-wrap">
            <a href="#formats"
              className="px-8 py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors shadow-sm">
              See advertising options
            </a>
            <a href="#contact"
              className="px-8 py-4 rounded-2xl border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold text-sm transition-colors">
              Get in touch
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-amber-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          {/* Dark text on the amber, and a dl so each label reads with its number. */}
          <dl className="grid grid-cols-1 sm:grid-cols-4 gap-10 sm:gap-8 text-center text-amber-950">
            {STATS.map(st => (
              <div key={st.label} className="flex flex-col-reverse gap-1">
                <dt className="text-amber-950 text-sm font-medium uppercase tracking-wider">{st.label}</dt>
                <dd className="text-5xl sm:text-4xl font-extrabold">{st.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Why advertise */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Why advertise with Smileys?</h2>
            <p className="text-gray-600 max-w-xl">
              Quantity is easy. Quality is rare. Our community is small by design — and that's the point.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {why.map(w => (
              <div key={w.title} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm">
                <div aria-hidden="true" className="text-2xl mb-4">{w.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{w.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <h2 className="text-3xl font-extrabold text-gray-900 mb-6">Our audience at a glance</h2>
              <div className="space-y-4">
                {[
                  { label: 'Languages',  value: `English-first, ${nationalities} nationalities` },
                  { label: 'Age range',  value: 'Primarily 25–55'                            },
                  { label: 'Profile',    value: 'Professionals, entrepreneurs, creatives'     },
                  { label: 'Location',   value: `${istanbulShare}% Istanbul-based`             },
                  // A media buyer will do the math on any per-member average
                  // (1,600 members × 3/week would dwarf our event volume) —
                  // claim only what the most active cohort actually does.
                  { label: 'Engagement', value: 'Our most active members attend multiple events per week' },
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
                co-working spaces, real estate. They're your most receptive audience.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Proof — no partner logos yet (partners table is empty), so the
          strongest available evidence is the rooms themselves: real event
          photos, member-consent-sensitive, swap via public/images/advertise. */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-10">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">The rooms your brand joins</h2>
            <p className="text-gray-600 max-w-xl">
              No stock photos — these are our events. Full rooms, real attention, people who showed up
              to be there.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(n => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={n} src={`/app/images/advertise/event-${n}.jpg`}
                alt="A Smileys community event"
                loading="lazy"
                className="aspect-[3/4] w-full object-cover rounded-2xl border border-gray-100 shadow-sm" />
            ))}
          </div>
        </div>
      </section>

      {/* Formats */}
      <section id="formats" className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Advertising formats</h2>
            <p className="text-gray-600 max-w-xl">
              Each format is designed to feel native to the community — not intrusive. No banner blindness, no ignored ads.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {FORMATS.map(f => (
              <div key={f.title} className={`rounded-2xl p-7 border ${
                f.highlight
                  ? 'bg-amber-500 border-amber-500'
                  : 'bg-white border-gray-100 shadow-sm'
              }`}>
                {/* No popularity badge: nothing has been sold yet. */}
                <div className="flex items-start justify-between mb-4">
                  <div aria-hidden="true" className="text-2xl">{f.icon}</div>
                </div>
                <h3 className={`text-lg font-bold mb-4 ${f.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {f.title}
                </h3>
                <ul className="space-y-2">
                  {f.features.map(feat => (
                    <li key={feat} className={`flex items-start gap-2 text-sm ${f.highlight ? 'text-amber-50' : 'text-gray-600'}`}>
                      <span aria-hidden="true" className={`mt-0.5 shrink-0 ${f.highlight ? 'text-white' : 'text-amber-500'}`}>✓</span>
                      {feat}
                    </li>
                  ))}
                </ul>
                <div className={`mt-5 text-sm font-bold ${f.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {PRICES[f.key] ?? 'Custom pricing'}
                </div>
                <a href="#contact"
                  className={`mt-3 block text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    f.highlight
                      ? 'bg-white text-amber-600 hover:bg-amber-50'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}>
                  Inquire
                </a>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-8">
            Pricing is tailored to your goals and format. Get in touch and we'll put together a proposal.
          </p>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" className="bg-white border-t border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-10">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Get in touch</h2>
            <p className="text-gray-600">
              Tell us about your brand and what you're looking to achieve.
              We read every inquiry and reply by email.
            </p>
          </div>
          <AdvertiseFormClient />
        </div>
      </section>

      {/* Partner-focused close — the global footer's member CTA band is
          suppressed on this page (see components/Footer.tsx): an advertiser
          page must not end by pitching membership. */}
      <section className="bg-amber-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          {/* Dark text on the amber; the button keeps its own colors. */}
          <h2 className="text-3xl sm:text-4xl font-extrabold text-amber-950 mb-4">
            Let&rsquo;s build something for your brand.
          </h2>
          <p className="text-amber-950 mb-10 text-lg">
            Tell us what you&rsquo;re trying to reach — we&rsquo;ll design the format around it.
          </p>
          <a href="#contact" className="btn-white inline-block">Get in touch</a>
        </div>
      </section>

    </div>
  )
}
