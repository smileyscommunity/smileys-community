import Link from 'next/link'
import AdvertiseFormClient from './AdvertiseFormClient'
import { loadContent } from '@/lib/content'

export const revalidate = 3600

export const metadata = {
  title: 'Advertise with Smileys — Reach Istanbul\'s Most Engaged Internationals',
  description: 'Partner with Smileys to reach a curated community of expats and global professionals actively building their life in Istanbul.',
  openGraph: {
    title: 'Advertise with Smileys Community',
    description: 'Reach vetted, active English-speaking internationals living in Istanbul through Smileys events, newsletter, and clubs.',
    url: 'https://smileyscommunity.com/advertise',
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
    body: "Minimal wasted reach. 80% of our members are based in Istanbul, making Smileys one of the most geographically precise channels in the city.",
  },
]

const FORMATS = [
  {
    key: 'event_sponsorship',
    icon: '🎉',
    title: 'Event Sponsorship',
    features: [
      'Brand visibility at a curated event (30–80 attendees)',
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
      'Avg. 45%+ open rate',
    ],
    highlight: true,
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

export default function AdvertisePage() {
  const c   = loadContent()
  const adv = c.advertise ?? {}
  // Optional rate card, editable from /admin/content without a deploy.
  // Keyed by format key with display strings, e.g.
  // { "newsletter": "from ₺7.500" }. Formats without a price show
  // "Custom pricing" so we never publish a number nobody set.
  const PRICES: Record<string, string> = adv.prices ?? {}
  const STATS = c.stats ?? [
    { value: '4,000+', label: 'Community members'    },
    { value: '500+',   label: 'Experiences hosted'   },
    { value: '85%',    label: 'International members' },
    { value: '70+',    label: 'Interest clubs'        },
  ]
  return (
    <main>

      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-6">
            ✦ Partner with Smileys
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-tight mb-6">
            {adv.headline ?? "Reach Istanbul's most engaged internationals"}
          </h1>
          <p className="text-base text-gray-500 max-w-2xl leading-relaxed">
            {adv.subtitle ?? "Smileys is a curated community of expats and global professionals actively building their life in Istanbul. Advertise where trust is already built in."}
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
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-10 sm:gap-8 text-center text-white">
            {STATS.map((s: { value: string; label: string }) => (
              <div key={s.label}>
                <div className="text-5xl sm:text-4xl font-extrabold mb-1">{s.value}</div>
                <div className="text-amber-100 text-sm font-medium uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why advertise */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Why advertise with Smileys?</h2>
            <p className="text-gray-500 max-w-xl">
              Quantity is easy. Quality is rare. Our community is small by design — and that's the point.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {WHY.map(w => (
              <div key={w.title} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm">
                <div className="text-2xl mb-4">{w.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{w.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{w.body}</p>
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
                  { label: 'Languages',  value: 'English-first, 45+ nationalities'           },
                  { label: 'Age range',  value: 'Primarily 25–55'                            },
                  { label: 'Profile',    value: 'Professionals, entrepreneurs, creatives'     },
                  { label: 'Location',   value: '80% Istanbul-based'                          },
                  { label: 'Engagement', value: 'Members attend 3+ events/week on average'   },
                  { label: 'Hosts',      value: '40+ activity hosts across clubs & events'   },
                  { label: 'Membership', value: 'Application-only, personally reviewed'       },
                ].map(r => (
                  <div key={r.label} className="flex gap-4 text-sm border-b border-gray-50 pb-4">
                    <span className="w-28 shrink-0 font-semibold text-gray-400">{r.label}</span>
                    <span className="text-gray-700">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Industries we work with</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {SECTORS.map(s => (
                  <span key={s} className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-xs font-semibold">
                    {s}
                  </span>
                ))}
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                Our members are actively exploring Istanbul — restaurants, fitness studios,
                co-working spaces, real estate. They're your most receptive audience.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Formats */}
      <section id="formats" className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Advertising formats</h2>
            <p className="text-gray-500 max-w-xl">
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
                <div className="flex items-start justify-between mb-4">
                  <div className="text-2xl">{f.icon}</div>
                  {f.highlight && (
                    <span className="text-xs font-bold bg-white/20 text-white px-2 py-1 rounded-full uppercase tracking-wide">
                      Most popular
                    </span>
                  )}
                </div>
                <h3 className={`text-lg font-bold mb-4 ${f.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {f.title}
                </h3>
                <ul className="space-y-2">
                  {f.features.map(feat => (
                    <li key={feat} className={`flex items-start gap-2 text-sm ${f.highlight ? 'text-amber-50' : 'text-gray-500'}`}>
                      <span className={`mt-0.5 shrink-0 ${f.highlight ? 'text-white' : 'text-amber-500'}`}>✓</span>
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
                  Enquire
                </a>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-400 mt-8">
            Pricing is tailored to your goals and format. Get in touch and we'll put together a proposal.
          </p>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" className="bg-white border-t border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-10">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Get in touch</h2>
            <p className="text-gray-500">
              Tell us about your brand and what you're looking to achieve.
              We'll get back to you within 48 hours.
            </p>
          </div>
          <AdvertiseFormClient />
        </div>
      </section>

    </main>
  )
}
