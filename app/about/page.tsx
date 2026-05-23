import Link from 'next/link'
import { loadContent } from '@/lib/content'

export const revalidate = 3600

export const metadata = {
  title: 'About Us — Smileys Community',
  description: "Learn about Smileys — Istanbul's curated social community bringing together expats and locals through events, clubs, and genuine connection.",
  openGraph: {
    title: 'About Smileys Community',
    description: "Istanbul's curated social community for expats and globally minded people.",
    url: 'https://smileyscommunity.com/about',
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
    body: 'Our members come from dozens of countries. What unites them is Istanbul — and a genuine curiosity about the world. You\'ll feel at home whether you arrived last week or last decade.',
  },
  {
    icon: '⚖️',
    title: 'Balanced by design',
    body: 'Many of our events are gender-balanced by default. We believe the best social dynamics happen when everyone feels equally welcome.',
  },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Apply',
    body: 'Tell us about yourself, what draws you to Istanbul, and what you\'re looking for in a community. Applications take about 5 minutes.',
  },
  {
    step: '02',
    title: 'Get vetted',
    body: 'Our team reviews every application personally — looking for vibe alignment, not credentials. Expect a response within 24–48 hours.',
  },
  {
    step: '03',
    title: 'Join the community',
    body: 'Once approved, browse upcoming events, join clubs that match your interests, and meet people who are actually excited to be there.',
  },
]

export default function AboutPage() {
  const c     = loadContent()
  const about = c.about ?? {}
  const stats = (c.stats ?? [
    { value: '4,000+', label: 'Community members'  },
    { value: '500+',   label: 'Experiences hosted' },
    { value: '70+',    label: 'Interest clubs'      },
  ]).slice(0, 3)

  return (
    <main>

      {/* ── Hero ── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-6">
            😊 Smileys Community
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-5">
            {about.headline ?? "Istanbul's curated social community"}
          </h1>
          <p className="text-base text-gray-500 max-w-xl leading-relaxed">
            {about.subtitle ?? 'We bring together curious, open-minded people through handpicked events, interest-based clubs, and a community that actually feels like one.'}
          </p>
          <div className="mt-8 flex items-center gap-4 flex-wrap">
            <Link href="/apply" className="btn-primary--lg">Apply to join</Link>
            <Link href="/events" className="btn-secondary">Browse events</Link>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="bg-amber-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 text-center text-white">
            {stats.map((s: { value: string; label: string }) => (
              <div key={s.label}>
                <div className="text-5xl md:text-4xl font-extrabold mb-1">{s.value}</div>
                <div className="text-amber-100 text-sm font-medium uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Story ── */}
      <section className="bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="section-title mb-6">Our story</h2>
          <div className="prose prose-gray max-w-none text-gray-600 leading-relaxed space-y-5">
            <p className="text-lg">{about.story_p1 ?? "Smileys started from a frustration most people moving to Istanbul share: the city is magnificent, full of energy and culture — but breaking into it socially is surprisingly hard. Existing expat groups felt impersonal. Dating apps weren't the answer. And showing up to a random \"networking event\" felt like the opposite of fun."}</p>
            <p>{about.story_p2 ?? "We built Smileys to fix that. Not another app where you swipe through strangers, but a real community where every face you see at an event has been thoughtfully welcomed. Where the host knows your name. Where the guest list is balanced, the venue is handpicked, and the atmosphere is warm from the moment you walk in."}</p>
            <p>{about.story_p3 ?? "Istanbul deserves a social scene that matches its character — vibrant, layered, and genuinely welcoming. That's what we're building, one event at a time."}</p>
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-14">
            <h2 className="section-title mb-3">What we stand for</h2>
            <p className="text-gray-500 max-w-xl">
              Four principles that shape everything we do — from who we approve to how we design events.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {VALUES.map(v => (
              <div key={v.title} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-2xl mb-4">{v.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{v.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="mb-14">
            <h2 className="section-title mb-3">How it works</h2>
            <p className="text-gray-500 max-w-xl">
              Membership is application-based. Not to be exclusive — but to make sure the community
              stays the kind of place everyone actually wants to be in.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(step => (
              <div key={step.step} className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-5">
                  <span className="text-amber-600 font-extrabold text-sm">{step.step}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/apply" className="btn-primary--lg">
              Apply to join
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── What to expect ── */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="section-title mb-4">What to expect</h2>
              <p className="text-gray-500 leading-relaxed mb-8">
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
                    <span className="text-2xl mt-0.5 shrink-0">{item.icon}</span>
                    <div>
                      <div className="font-bold text-gray-900 mb-1">{item.title}</div>
                      <div className="text-sm text-gray-500 leading-relaxed">{item.body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-8 text-center">
              <div className="text-5xl mb-5">🎉</div>
              <h3 className="text-xl font-extrabold text-gray-900 mb-3">Still on the fence?</h3>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="section-title mb-3">Find your people</h2>
          <p className="text-gray-500 max-w-xl mb-10">
            From sailing and wine tasting to book clubs and language exchange — our clubs are built
            around shared passions, not just shared geography.
          </p>
          <Link href="/clubs"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl border border-gray-200 hover:bg-white text-gray-700 font-semibold text-sm transition-colors">
            Explore clubs
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="bg-amber-500">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <span className="text-5xl block mb-6">😊</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
            Ready to feel at home in Istanbul?
          </h2>
          <p className="text-amber-100 mb-10 text-lg">
            Join a community of people who came from all over the world and found their people here.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
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
