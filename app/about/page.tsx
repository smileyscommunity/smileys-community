import Link from 'next/link'
import { resolveStats } from '@/lib/communityStats'
import Image from 'next/image'
import { APP_URL } from '@/lib/env'
import { loadContent } from '@/lib/content'

export const revalidate = 3600

// A page-level `openGraph` block loses the root layout's default og:image —
// Next.js doesn't deep-merge nested metadata fields — so any page that
// customizes openGraph needs to set its own image or it shares with no
// preview at all on WhatsApp/iMessage/Twitter (all require og:image to
// render a card). The static hero photo (about-hero.jpg, 570KB) is over
// WhatsApp's ~300KB silent-drop threshold, so this uses the same dynamic
// title-card generator as the homepage default instead of the raw photo.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'About Smileys Community',
  eyebrow: "Curated city communities",
  cta:     'Apply to join',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/about` },
  title: 'About Us — Smileys Community',
  description: "Learn about Smileys — curated city communities bringing together expats and locals through events, clubs, and genuine connection.",
  openGraph: {
    title: 'About Smileys Community',
    description: "Curated city communities for expats and globally minded people.",
    url: `${APP_URL}/about`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'About Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Smileys Community',
    description: "Curated city communities for expats and globally minded people.",
    images: [ogImage],
  },
}

const VALUES = [
  {
    icon: '✦',
    title: 'Curated, not crowded',
    body: 'Every member is personally reviewed. We keep the community intentionally small so that every event feels like a gathering of like-minded people — not a networking circus.',
  },
  {
    icon: '🤝',
    title: 'Real connections',
    body: 'We design events for conversation, not just attendance. Smaller guest lists, shared interests, and recurring faces mean friendships that actually last.',
  },
  {
    icon: '🌍',
    title: 'Global minds, local roots',
    body: 'Our members come from dozens of countries. What unites them is the city they share — and a genuine curiosity about the world. You\'ll feel at home whether you arrived last week or last decade.',
  },
  {
    icon: '⚖️',
    title: 'Balanced by design',
    body: 'Many of our events are gender-balanced by default. We believe the best social dynamics happen when everyone feels equally welcome.',
  },
]

// (No local stat fallback: resolveStats measures its own defaults from the
// DB when the CMS supplies none — a typed array here is exactly the kind of
// number that drifts from every other page's, which is how this site once
// published three different club counts.)

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: '📝',
    title: 'Apply',
    body: 'Tell us about yourself, what draws you to your city, and what you\'re looking for in a community. Applications take about 5 minutes.',
  },
  {
    step: '02',
    icon: '✅',
    title: 'Get vetted',
    body: 'Our team reviews every application personally — looking for vibe alignment, not credentials. Expect a response within 24–48 hours.',
  },
  {
    step: '03',
    icon: '🤝',
    title: 'Join the community',
    body: 'Once approved, browse upcoming events, join clubs that match your interests, and meet people who are actually excited to be there.',
  },
]

export default async function AboutPage() {
  const c     = loadContent()
  const about = c.about ?? {}
  // `??` only triggers on null/undefined — an empty `c.stats = []`
  // would otherwise render zero stat tiles. Guard on .length so the
  // defaults are used whenever content didn't supply any.
  const rawStats = await resolveStats(c.stats)
  if (process.env.NODE_ENV !== 'production' && rawStats.length > 3) {
    console.warn(`[about] content has ${rawStats.length} stats but the layout only shows 3 — extras silently dropped. Trim content.json or widen the grid.`)
  }
  const stats = rawStats.slice(0, 3)

  return (
    <main>

      {/* ── Hero ── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-8">
                About us
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-5">
                {about.headline ?? "Curated city communities, born in Istanbul"}
              </h1>
              <p className="text-base text-gray-600 max-w-xl leading-relaxed">
                {about.subtitle ?? 'We bring together curious, open-minded people through handpicked events, interest-based clubs, and a community that actually feels like one.'}
              </p>
              {/* flex-col + default stretch makes both buttons the same
                  (full) width on mobile — matches the homepage hero CTA
                  pair exactly. Previously btn-primary--lg (px-8 py-4) vs
                  bare btn-secondary (px-6 py-3) sized differently on every
                  viewport, and flex-wrap (no flex-col) let them size to
                  their own text instead of matching. */}
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Link href="/apply" className="btn-primary text-base px-8 py-4">Apply to join</Link>
                <Link href="/events" className="btn-secondary text-base px-8 py-4">Browse events</Link>
              </div>
            </div>
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-xl">
              <Image
                src="/app/images/about-hero.jpg"
                alt="Smileys members gathered on an Istanbul rooftop at sunset, Galata Tower and the Bosphorus in the background"
                fill
                priority
                fetchPriority="high"
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
                style={{ objectPosition: 'center 65%' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="bg-amber-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          {/* dl/dt/dd so SRs read this as a definition list ("term:
              Community members, value: 4,000+"). Visual order is
              value-then-label, so each pair sits in a flex-col-reverse
              that flips the render while keeping the dt-before-dd
              source order the spec requires. */}
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 text-center text-white">
            {stats.map((s: { value: string; label: string }) => (
              <div key={s.label} className="flex flex-col-reverse gap-1">
                <dt className="text-amber-100 text-sm font-medium uppercase tracking-wider">{s.label}</dt>
                <dd className="text-4xl md:text-5xl font-extrabold">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Story ── */}
      {/* Every section on this page shares max-w-5xl (matching the Hero)
          so every mx-auto-centered container's left edge lines up all the
          way down the page — the homepage does the same thing (max-w-7xl
          everywhere). This page used to mix 5xl/4xl/3xl across sections;
          narrower sections sat visibly inset from the Hero above them,
          reading as "centered" by comparison even though the text itself
          was always left-aligned. */}
      {/* Owner-authored narrative (2026-08-30) — four titled chapters, so it
          lives here as JSX rather than in the CMS's flat story_p1..p3 keys,
          which this section no longer reads. */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="section-title mb-6">Our story</h2>
          <div className="prose prose-gray max-w-none text-gray-600 leading-relaxed space-y-5">
            <p className="text-lg font-semibold text-gray-800">Moving to a new city is exciting. Finding your people is the hard part.</p>
            <p>Our founder knows this firsthand. He spent 20 years in New York City, building a life far from home.</p>
            <p>In the days after September 11, being far from home suddenly felt very different. New York was grieving, tense, and for many immigrants, lonelier than ever. He felt that Turkish New Yorkers needed each other more than they ever had. So he started NYCTurk, a community to bring them together.</p>
            <p>What began as a response to a difficult moment grew into something lasting. For 15 years, thousands of people came to NYCTurk events. They met friends, celebrated culture, and found belonging in a city that can feel enormous and anonymous.</p>
            <p>Fifteen years of hosting taught him one thing:</p>
            <p className="border-l-4 border-amber-400 pl-4 text-gray-800 font-semibold">People don&rsquo;t need more ways to connect. They need better opportunities to connect in real life.</p>
            <p>Smileys is the next chapter.</p>

            <h3 className="text-lg font-bold text-gray-900 pt-4">A new city, the same question</h3>
            <p>We started in Istanbul with a simple question: how do you make a new city feel like home?</p>
            <p>Istanbul is vibrant, international, and full of people from everywhere. Yet real friendship is still hard to find. Big meetup groups feel impersonal. Dating apps aren&rsquo;t built for friendship. Networking events are about business cards, not people.</p>
            <p>So we built Smileys: a real-life social community designed around genuine connection. Not an app where you swipe through strangers, but a place where people actually meet. Our events are hosted, the venues are chosen with care, the groups are balanced, and it always feels natural to walk in alone.</p>
            <p>The goal was never one great night. The people you meet become familiar faces. Familiar faces become friends. Friends become your community. And a city that felt unfamiliar starts to feel like home.</p>

            <h3 className="text-lg font-bold text-gray-900 pt-4">Why &ldquo;Smileys&rdquo;?</h3>
            <p>Because that&rsquo;s what connection looks like. Walk into any of our events and you&rsquo;ll see it: a room full of people smiling, talking, meeting someone new. We named the community after the thing we&rsquo;re actually building.</p>

            <h3 className="text-lg font-bold text-gray-900 pt-4">From one city to everywhere</h3>
            <p>Smileys started in Istanbul, but it was never meant to stay in one city. We&rsquo;re expanding to new cities with one ambition: a global community where you can find your people wherever you are in the world.</p>
            <p>Whether you just moved, you&rsquo;re traveling, studying, working abroad, or you&rsquo;re a local who wants to meet people beyond your circle, Smileys is where you start.</p>
            <p>Belonging shouldn&rsquo;t depend on where you were born, who you already know, or how long you&rsquo;ve lived somewhere. Everyone deserves a place where they can walk in, feel welcome, and find their people.</p>
            <p className="text-gray-800 font-semibold">We&rsquo;re not just helping people meet. We&rsquo;re helping people find their people.</p>
          </div>
        </div>
      </section>

      {/* ── What makes Smileys different (owner-authored, 2026-08-30) ── */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="mb-10">
            <h2 className="section-title mb-3">What makes Smileys different?</h2>
            <p className="text-gray-600 max-w-xl">Not another meetup. Not another app.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              { icon: '🤝', title: 'Curated people',
                body: 'We review every application because the people in the room matter as much as the event itself.' },
              { icon: '🎙️', title: 'Hosted experiences',
                body: "You don't have to arrive knowing anyone. Our hosts make introductions and help the room come alive." },
              { icon: '💛', title: 'Designed for friendship',
                body: "We're not optimizing for matches, followers, or business cards. We're creating opportunities for genuine friendships." },
              { icon: '🌱', title: 'Community beyond events',
                body: 'Events are where you meet. Clubs, hangouts and recurring activities are where friendships grow.' },
            ].map(d => (
              <div key={d.title} className="bg-gray-50 rounded-2xl p-7 border border-gray-100">
                <div aria-hidden="true" className="text-2xl mb-4">{d.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{d.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="mb-10">
            <h2 className="section-title mb-3">What we stand for</h2>
            <p className="text-gray-600 max-w-xl">
              Four principles that shape everything we do — from who we approve to how we design events.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {VALUES.map(v => (
              <div key={v.title} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm">
                <div aria-hidden="true" className="text-2xl mb-4">{v.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{v.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="mb-10">
            <h2 className="section-title mb-3">How it works</h2>
            <p className="text-gray-600 max-w-xl">
              Membership is application-based. Not to be exclusive — but to make sure the community
              stays the kind of place everyone actually wants to be in.
            </p>
          </div>
          {/* ol so SRs announce "list of 3 steps" and the explicit
              01/02/03 numbering reflects in the document outline.
              list-none kills the default decimal marker since the
              circled step number renders the order visually. */}
          <ol className="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(step => (
              <li key={step.step} className="text-center">
                <div aria-hidden="true" className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-amber-200 shadow-sm text-2xl mb-4">
                  {step.icon}
                </div>
                <div className="step-label mb-1">{step.step}</div>
                <h3 className="text-lg font-extrabold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── What to expect ── */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="section-title mb-4">What to expect</h2>
              <p className="text-gray-600 leading-relaxed mb-8">
                First events can feel daunting. Here's what actually happens when you show up to a Smileys event.
              </p>
              <ul className="space-y-5">
                {[
                  { icon: '👋', title: 'A warm welcome', body: 'Every event has a host whose job is to make introductions. You will never have to walk into a room and figure it out alone.' },
                  { icon: '👥', title: 'Small, balanced groups', body: 'We keep guest lists tight — typically 20 to 60 people — and gender-balanced by default. It feels more like a dinner party than a conference.' },
                  { icon: '🌍', title: 'Instant common ground', body: 'Everyone in the room chose to be here. That shared curiosity about Istanbul is the icebreaker. The conversations start easily.' },
                  { icon: '🔁', title: 'Familiar faces, fast', body: 'Members attend regularly. Within two or three events, you start recognising people. That\'s when it starts feeling like a community.' },
                ].map(item => (
                  <li key={item.title} className="flex gap-4">
                    <span aria-hidden="true" className="text-2xl mt-0.5 shrink-0">{item.icon}</span>
                    <div>
                      <div className="font-bold text-gray-900 mb-1">{item.title}</div>
                      <div className="text-sm text-gray-600 leading-relaxed">{item.body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-8 text-center">
              <div aria-hidden="true" className="text-5xl mb-5">🎉</div>
              <h3 className="text-xl font-extrabold text-gray-900 mb-3">Still on the fence?</h3>
              <p className="text-gray-600 text-sm leading-relaxed mb-6">
                The most common thing members say after their first event: "I wish I'd come sooner."
                Apply takes 5 minutes. You can always say no to events until you find the right one.
              </p>
              <Link href="/apply"
                className="inline-block px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors">
                Apply to join
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Clubs preview ── */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="section-title mb-3">Find your people</h2>
          <p className="text-gray-600 max-w-xl mb-10">
            From sailing and wine tasting to book clubs and language exchange — our clubs are built
            around shared passions, not just shared geography.
          </p>
          <Link href="/clubs"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl border border-gray-200 hover:bg-white text-gray-700 font-semibold text-sm transition-colors">
            Explore clubs
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="bg-amber-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
            😊 Ready to feel at home in Istanbul?
          </h2>
          <p className="text-amber-100 mb-10 text-lg">
            Join a community of people who came from all over the world and found their people here.
          </p>
          {/* flex-col + default stretch matches the hero CTA pair's mobile
              stacking fix — this footer CTA had the same two-different-widths
              issue on narrow screens that the hero already fixed. */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/apply" className="btn-white">
              Apply to join
            </Link>
            <Link href="/contact" className="btn-outline-white">
              Get in touch
            </Link>
          </div>
        </div>
      </section>

    </main>
  )
}
