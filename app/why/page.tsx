import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl } from '@/lib/data'
import AnimatedCounter from '@/components/AnimatedCounter'
import { loadContent } from '@/lib/content'

const getWhyPageData = unstable_cache(
  async () => Promise.all([
    prisma.testimonial.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] }),
    prisma.storyPhoto.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { createdAt: 'desc' }], take: 12 }),
    prisma.club.findMany({ where: { isActive: true }, orderBy: { memberCount: 'desc' }, take: 8, select: { id: true, name: true, emoji: true, bgColor: true, color: true, description: true, memberCount: true, slug: true } }),
  ]),
  ['why-page'],
  { revalidate: 300, tags: ['why-page'] },
)

export const metadata = {
  alternates: { canonical: `${APP_URL}/why` },
  title: 'Why Smileys? — Find Your People in Istanbul',
  description: 'Istanbul can feel crowded and still lonely. Smileys is the curated social community for globally minded people building a real social life in the city.',
  openGraph: {
    title: 'Why Smileys? — Find Your People in Istanbul',
    description: 'A curated real-life social ecosystem for globally minded people in Istanbul.',
    url: `${APP_URL}/why`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Why Smileys? — Find Your People in Istanbul',
    description: 'A curated real-life social ecosystem for globally minded people in Istanbul.',
  },
}


const CAT_PILL: Record<string, string> = {
  general:  'bg-gray-100 text-gray-600',
  friends:  'bg-green-100 text-green-700',
  expat:    'bg-blue-100 text-blue-700',
  business: 'bg-purple-100 text-purple-700',
  travel:   'bg-amber-100 text-amber-700',
}
const CAT_LABEL: Record<string, string> = {
  general:  'Member',
  friends:  'Made close friends',
  expat:    'New to Istanbul',
  business: 'Found business partners',
  travel:   'Found travel buddies',
}

const MOCK_TESTIMONIALS = [
  { id: 'm1', memberName: 'Sophie M.', role: 'Moved from London', quote: 'I arrived not knowing a single person. Within two months I had a circle of friends I\'d happily call my closest. It completely changed what Istanbul means to me.', category: 'expat', photo: null },
  { id: 'm2', memberName: 'James R.', role: 'Entrepreneur', quote: 'I met my business co-founder at a Smileys dinner. We launched our startup six months later. I couldn\'t have written this story without this network.', category: 'business', photo: null },
  { id: 'm3', memberName: 'Lena K.', role: 'Digital nomad', quote: 'Found three travel companions for a sailing trip in the Aegean. We\'d only met twice at events before. Best trip of my life — with people who are now genuine friends.', category: 'travel', photo: null },
  { id: 'm4', memberName: 'Marcus T.', role: 'Expat — 6 cities', quote: 'I\'ve lived in six cities. Smileys is the first place that made a new city feel like home within weeks, not years.', category: 'expat', photo: null },
  { id: 'm5', memberName: 'Yasmin O.', role: 'Creative director', quote: 'The quality of people here is remarkable. Everyone is curious, open, and genuinely interested in connecting. You rarely find that anywhere.', category: 'friends', photo: null },
  { id: 'm6', memberName: 'Alex B.', role: 'Remote engineer', quote: 'I came for the events. I stayed for the people. My Smileys circle has become my Istanbul family.', category: 'friends', photo: null },
]

const WEEK: { day: string; short: string; emoji: string; event: string; desc: string }[] = [
  { day: 'Monday',    short: 'MON', emoji: '🎬', event: 'Movie Night',                    desc: 'A carefully picked film, good company, and conversations that continue long after the credits roll.' },
  { day: 'Tuesday',  short: 'TUE', emoji: '🇫🇷', event: 'French Meetup',                  desc: 'Practice your French, meet fellow language lovers, or start from zero — bonne ambiance garantie.' },
  { day: 'Wednesday', short: 'WED', emoji: '🎉', event: "Let's Get Social",               desc: 'The signature midweek gathering. New faces, familiar faces, spontaneous conversations, and the kind of evenings that never feel forced.' },
  { day: 'Thursday',  short: 'THU', emoji: '🇹🇷', event: 'Turkish Language & Culture',    desc: 'Learn the language, understand the culture, and experience the city through locals and fellow learners.' },
  { day: 'Friday',    short: 'FRI', emoji: '🎮', event: 'Game Night & Club Night',         desc: 'Board games, social games, laughter, and late-night energy. Friday nights belong to Smileys.' },
  { day: 'Saturday',  short: 'SAT', emoji: '📸', event: 'Photowalk & Picnic',             desc: 'Discover hidden corners of the city, capture moments together, then slow down with a relaxed picnic outdoors.' },
  { day: 'Sunday',    short: 'SUN', emoji: '🥞', event: 'Brunch, Meditation, Hiking & Sailing', desc: 'Slow mornings, long brunch tables, trails in nature, breathwork sessions, island hikes, or a day out on the sea. The perfect reset before a new week begins.' },
]

const DIFFERENTIATORS = [
  { icon: '🔍', title: 'Curated membership', body: 'Every person is personally reviewed before they join. The result is a network you can actually trust.' },
  { icon: '🤝', title: 'Real-life first',    body: 'We\'re not a chat group or a feed. We\'re built around shared experiences that create lasting bonds.' },
  { icon: '🏛️', title: 'Interest-based circles', body: 'Sailing. Jazz. Language exchange. Hiking. Business. Whatever you\'re into, there\'s a club for it.' },
  { icon: '📅', title: 'Weekly rhythm',      body: 'Something every week, year-round. Consistent enough to build real habits — and real friendships.' },
  { icon: '🌍', title: 'International & local', body: 'Expats, nomads, locals, travelers — one network. The mix is what makes it interesting.' },
  { icon: '🛡️', title: 'Protected culture', body: 'No drama, no spam, no bad actors. We actively maintain the atmosphere so everyone feels safe.' },
]

const WHO = ['Expats', 'Digital nomads', 'Travelers', 'Entrepreneurs', 'Creatives', 'Remote workers', 'Language learners', 'Globally minded locals', 'People new to the city', 'People rebuilding their circle']

const PHILOSOPHY = [
  'Real friendships still matter.',
  'Circles should feel intentional — not accidental.',
  'A city becomes yours when you have people in it.',
  'The best experiences are shared ones.',
]

export default async function WhyPage() {
  const [dbTestimonials, dbPhotos, clubs] = await getWhyPageData()

  const c    = loadContent()
  const week = (c.week?.length > 0 ? c.week : null) ?? WEEK
  const why  = c.why ?? {}
  const testimonials = dbTestimonials.length > 0 ? dbTestimonials : MOCK_TESTIMONIALS

  return (
    <main className="bg-white overflow-x-hidden">

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-8">
            😊 Smileys Community
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-4">
            {why.headline ?? 'Istanbul can feel crowded — and still lonely.'}
          </h1>
          <p className="text-base font-semibold text-amber-600 mb-6">
            {why.tagline ?? 'A curated real-life social ecosystem for globally minded people in Istanbul.'}
          </p>
          <p className="text-base text-gray-600 max-w-2xl leading-relaxed mb-5">
            {why.subtitle ?? 'Thousands of people arrive here every month looking for connection, friendship, and a circle they actually belong to. But most platforms feel random, transactional, or exhausting.'}
          </p>
          <p className="text-base text-gray-900 font-semibold max-w-2xl leading-relaxed mb-10">
            {why.closing ?? 'Smileys was built to change that.'}
          </p>
          {/* flex-col + default stretch makes both buttons the same
              width on mobile, matching the About/homepage hero CTA pair. */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/apply" className="btn-primary text-base px-8 py-4">
              Apply to join
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link href="/events" className="btn-secondary text-base px-8 py-4">Browse events</Link>
          </div>
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────── */}
      <section className="bg-amber-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          {/* dl/dt/dd so SRs read this as a definition list, matching the
              About page's identical stat band. value-then-label visually via
              flex-col-reverse, dt-before-dd in source order as the spec
              requires. Also fixes the value size previously going
              4xl → md:3xl → lg:4xl (shrinking then growing back). */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10 sm:gap-6 text-center text-white">
            {(c.stats ?? [
              { value: '4,000+', label: 'Members'        },
              { value: '500+',   label: 'Events hosted'  },
              { value: '20+',    label: 'Active clubs'   },
              { value: '59+',    label: 'Neighborhoods' },
            ]).map((s: { value: string; label: string }) => (
              <div key={s.label} className="flex flex-col-reverse gap-1">
                <dt className="text-amber-100 text-sm uppercase tracking-wider">{s.label}</dt>
                <dd className="text-4xl md:text-5xl font-extrabold">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── WHAT MAKES US DIFFERENT ──────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">
              Not just another group.
            </h2>
            <p className="text-lg text-gray-600 max-w-xl">
              There are plenty of WhatsApp chats, Meetup pages, and nightlife groups. Here's why people choose Smileys instead.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {DIFFERENTIATORS.map(d => (
              <div key={d.title} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm">
                <div aria-hidden="true" className="text-2xl mb-4">{d.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{d.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── A WEEK INSIDE SMILEYS ────────────────────────────── */}
      <section className="py-24 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">A week inside Smileys</h2>
            <p className="text-gray-600 max-w-xl">This isn't a one-time event you forget by Monday. It's a rhythm that slowly becomes part of your life.</p>
          </div>
          <div className="space-y-3">
            {week.map((w: typeof WEEK[0], i: number) => (
              <div key={w.day}
                className="flex items-center gap-5 bg-white border border-gray-100 rounded-2xl px-5 py-4 hover:border-amber-300 hover:shadow-sm transition-all group">
                <div className="shrink-0 w-12 text-center">
                  <div className="text-xs font-bold text-amber-500 tracking-widest">{w.short}</div>
                </div>
                <div className="text-2xl shrink-0">{w.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{w.event}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">{w.desc}</p>
                </div>
                <div className="shrink-0 w-6 h-6 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center group-hover:bg-amber-50 group-hover:border-amber-300 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-amber-500 transition-colors" />
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400 mt-6">Events vary by week. New experiences added regularly.</p>
        </div>
      </section>

      {/* ── MORE THAN EVENTS ─────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <h2 className="section-title mb-6">
                More than events.<br />
                <span className="text-amber-500">A real social ecosystem.</span>
              </h2>
              <p className="text-gray-600 leading-relaxed mb-8">
                The events are just the entry point. What actually happens is something deeper — people find their circle, build a life in a new city, collaborate, travel together, and stay in touch long after the event ends.
              </p>
              <ul className="space-y-3">
                {[
                  'Finding your people in a new city',
                  'Building friendships that last beyond one meeting',
                  'Discovering Istanbul\'s hidden sides with locals',
                  'Feeling like you actually belong somewhere',
                  'Creating a social life that grows with you',
                ].map(item => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="text-amber-500 font-bold shrink-0 mt-0.5">→</span>
                    <span className="text-gray-700 text-sm leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { emoji: '🏔️', label: 'Adventure & outdoors' },
                { emoji: '🍷', label: 'Food & dining'        },
                { emoji: '🎨', label: 'Arts & culture'       },
                { emoji: '💼', label: 'Professional network'  },
                { emoji: '🌊', label: 'Water & sailing'      },
                { emoji: '📚', label: 'Learning & growth'    },
              ].map(c => (
                <div key={c.label} className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100 hover:border-amber-200 transition-colors">
                  <div aria-hidden="true" className="text-3xl mb-2">{c.emoji}</div>
                  <p className="text-xs font-semibold text-gray-600">{c.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CLUBS SHOWCASE ───────────────────────────────────── */}
      {clubs.length > 0 && (
        <section className="py-24 bg-gray-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12">
              <h2 className="section-title mb-4">Your next obsession is already here.</h2>
              <p className="text-gray-600 max-w-xl">Interest-based circles for every personality. Join one. Join five. Build your Smileys world.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {clubs.map(c => (
                <Link key={c.id} href={`/clubs/${c.slug}`}
                  className="rounded-2xl p-4 text-center hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 border border-white/60"
                  style={{ backgroundColor: c.bgColor || '#fef3c7' }}>
                  <div aria-hidden="true" className="text-3xl mb-2">{c.emoji}</div>
                  <p className="text-sm font-bold text-gray-900 leading-snug">{c.name}</p>
                  <p className="text-xs mt-1" style={{ color: c.color || '#92400e' }}>{c.memberCount} members</p>
                </Link>
              ))}
            </div>
            <div className="text-center mt-8">
              <Link href="/clubs" className="inline-flex items-center min-h-[44px] px-2 text-sm font-semibold text-amber-600 hover:underline">
                See all clubs →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── TESTIMONIALS ─────────────────────────────────────── */}
      <section className="py-24 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">In their own words.</h2>
            <p className="text-gray-600 max-w-xl">Real members. No scripts. No incentives to say nice things.</p>
          </div>
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
            {testimonials.map(t => {
              const catLabel = CAT_LABEL[t.category] ?? 'Member'
              const catCls   = CAT_PILL[t.category]  ?? 'bg-gray-100 text-gray-600'
              return (
                <div key={t.id} className="break-inside-avoid bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:border-amber-200 transition-colors">
                  <p className="text-amber-500 text-3xl leading-none mb-3 font-serif">"</p>
                  <p className="text-sm text-gray-700 leading-relaxed mb-4">{t.quote}"</p>
                  <div className="flex items-center gap-2.5 pt-3 border-t border-gray-100">
                    {t.photo ? (
                      <img src={resolveImageUrl(t.photo)} alt={t.memberName}
                        className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full shrink-0 bg-amber-500 flex items-center justify-center text-white text-xs font-bold">
                        {t.memberName[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900">{t.memberName}</p>
                      {t.role && <p className="text-xs text-gray-400">{t.role}</p>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${catCls}`}>{catLabel}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── EVENT PHOTOS ─────────────────────────────────────── */}
      {dbPhotos.length > 0 && (
        <section className="py-24 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12">
              <h2 className="section-title mb-4">Life inside Smileys.</h2>
              <p className="text-gray-600 max-w-xl">A glimpse of the moments, experiences, and memories our members create every week.</p>
            </div>
            <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3">
              {dbPhotos.map(p => (
                <div key={p.id} className="break-inside-avoid relative rounded-2xl overflow-hidden group">
                  <img src={resolveImageUrl(p.url)} alt={p.caption ?? 'Smileys event'}
                    className="w-full object-cover" />
                  {(p.caption || p.event) && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                      {p.caption && <p className="text-xs text-white font-medium">{p.caption}</p>}
                      {p.event   && <p className="text-xs text-amber-300">{p.event}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── WHO JOINS ────────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="section-title mb-4">Who's in the room?</h2>
          <p className="text-gray-600 max-w-xl mx-auto mb-10">Smileys attracts a specific kind of person — curious, open, and genuinely interested in more than surface-level interaction.</p>
          <div className="flex flex-wrap gap-3">
            {WHO.map(w => (
              <span key={w} className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm font-medium text-gray-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-colors">
                {w}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="py-24 bg-amber-50 border-y border-amber-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">How it works.</h2>
            <p className="text-gray-600 max-w-xl">Simple. Human. Intentional.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { step: '01', icon: '📝', title: 'Apply',     desc: 'Fill out a short application. We review every profile personally to keep the quality high.' },
              { step: '02', icon: '✅', title: 'Get approved', desc: 'Once approved, you get full access — events, clubs, members, and everything in between.' },
              { step: '03', icon: '🤝', title: 'Show up',   desc: 'Attend an event. Join a club. Meet someone. Your circle starts with a single yes.' },
            ].map(s => (
              <div key={s.step} className="text-center">
                <div aria-hidden="true" className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-amber-200 shadow-sm text-2xl mb-4">
                  {s.icon}
                </div>
                <div className="step-label mb-1">{s.step}</div>
                <h3 className="text-lg font-extrabold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────── */}
      {/* Applying and event pages both stay silent on cost until after
          approval — a curious visitor had no way to find this out short of
          finishing a 5-step application. Numbers here are the real current
          shape of pricing (checked against live event data), described
          qualitatively rather than as a stat that'll go stale next week. */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">What does it cost?</h2>
            <p className="text-gray-600 max-w-xl">No membership fee. No surprises.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: '💛', title: 'Free to apply',        desc: 'Applying and getting approved costs nothing — no membership fee, ever.' },
              { icon: '🎉', title: 'Most events are free',  desc: 'The majority of our events have no cost at all. Just RSVP and show up.' },
              { icon: '🎟️', title: 'Paid events, upfront',  desc: 'When an event has a cost — venue, food, an activity — the price is shown clearly before you RSVP, usually ₺250–1,200.' },
              { icon: '🏛️', title: 'Clubs are always free', desc: 'Every interest-based club is free to join. No exceptions.' },
            ].map(s => (
              <div key={s.title} className="text-center sm:text-left">
                <div aria-hidden="true" className="text-3xl mb-3">{s.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-8 max-w-xl">
            Some hosts also offer a discounted member price on paid events — one more reason approval is worth it.
          </p>
        </div>
      </section>

      {/* ── PHILOSOPHY ───────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="section-title mb-12">What we believe.</h2>
          <div className="space-y-6">
            {PHILOSOPHY.map((p, i) => (
              <div key={i} className="flex items-center gap-4 text-left">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white font-bold text-sm flex items-center justify-center shrink-0">
                  {i + 1}
                </div>
                <p className="text-lg text-gray-800 font-medium">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ────────────────────────────────────── */}
      <section className="py-16 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { icon: '🔒', title: 'Screened community',   desc: 'Every application is personally reviewed. No random strangers.' },
              { icon: '⭐', title: 'Active, trusted hosts', desc: 'Events are run by experienced hosts who know how to create connection.' },
              { icon: '✅', title: 'Real profiles',         desc: 'No anonymous accounts. Everyone shows up as themselves.' },
            ].map(s => (
              <div key={s.title}>
                <div aria-hidden="true" className="text-3xl mb-3">{s.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="py-28 bg-amber-500 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #ffffff 0%, transparent 50%), radial-gradient(circle at 70% 50%, #92400e 0%, transparent 50%)' }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-amber-200 text-sm font-bold tracking-widest uppercase mb-4">The feeling you're looking for</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-5">
            😊 Ready to feel at home in Istanbul?
          </h2>
          <p className="text-amber-100 text-lg mb-3 max-w-xl mx-auto leading-relaxed">
            Not another endless group chat.<br />
            Not another networking event you forget tomorrow.
          </p>
          <p className="text-white text-xl font-bold mb-10">
            A place to actually belong.
          </p>
          {/* flex-col + default stretch matches the hero CTA pair's mobile
              stacking fix — this footer CTA had the same two-different-widths
              issue on narrow screens that the hero already fixed. */}
          <div className="flex flex-col sm:flex-row sm:justify-center gap-4">
            <Link href="/apply" className="btn-white">
              Apply to join
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link href="/events" className="btn-outline-white">Browse events first</Link>
          </div>
        </div>
      </section>

    </main>
  )
}
