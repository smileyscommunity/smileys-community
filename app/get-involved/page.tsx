import Link from 'next/link'

export const metadata = {
  title: 'Get Involved — Smileys Community',
  description: 'Host events, start clubs, and help build Istanbul\'s most vibrant social community.',
}

const WAYS = [
  {
    emoji: '🎉',
    title: 'Host an event',
    subtitle: 'Share your passion with the community',
    body: 'Have an idea for a dinner, a hike, a cultural visit, a language exchange? Hosts are the heartbeat of Smileys. You bring the concept — we handle the platform, RSVPs, and member matching.',
    perks: [
      'Full event management tools — RSVPs, guest lists, check-in',
      'Access to our network of vetted venues and suppliers',
      'A dedicated community of people who actually show up',
      'Host badge on your profile',
    ],
    cta: 'Apply to become a host',
    href: '/contact',
    accent: true,
  },
  {
    emoji: '⬡',
    title: 'Start a club',
    subtitle: 'Build your own community within the community',
    body: 'Got a niche interest that doesn\'t have a home yet? Sailing, chess, French cinema, cold plunges — if it\'s your thing, chances are it\'s someone else\'s too. Start a club and we\'ll help you grow it.',
    perks: [
      'Your own club page with member management',
      'Dedicated WhatsApp group for your members',
      'Tools to organise recurring events and activities',
      'Club featured in the Smileys directory',
    ],
    cta: 'Propose a club',
    href: '/contact',
    accent: false,
  },
  {
    emoji: '✉️',
    title: 'Invite a friend',
    subtitle: 'The community grows one great person at a time',
    body: 'Smileys is curated by design — every new member is reviewed personally. The best way to bring great people in is through the people already here. Your invite carries your reputation.',
    perks: [
      'Your referral is noted during the application review',
      'Invited friends get a warm introduction to your clubs',
      'Help shape what kind of community Smileys becomes',
    ],
    cta: 'Invite someone',
    href: '/invite',
    accent: false,
  },
]

import { loadContent } from '@/lib/content'

export const revalidate = 3600

const STATS_FALLBACK = [
  { value: '40+',  label: 'Active hosts' },
  { value: '70+',  label: 'Interest clubs' },
  { value: '500+', label: 'Experiences hosted' },
]

export default function GetInvolvedPage() {
  const c          = loadContent()
  const gi         = c.get_involved ?? {}
  const STATS      = c.stats?.slice(0, 3) ?? STATS_FALLBACK
  return (
    <main>

      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-8">
            ✦ Get involved
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-tight mb-6">
            {gi.headline ?? 'Help build the community you want to be part of'}
          </h1>
          <p className="text-base text-gray-500 max-w-2xl leading-relaxed">
            {gi.subtitle ?? "Smileys is shaped by its members. The best events, the most active clubs, the warmest atmosphere — they all start with someone deciding to show up and contribute."}
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-amber-500">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 text-center text-white">
            {STATS.map((s: { value: string; label: string }) => (
              <div key={s.label}>
                <div className="text-5xl md:text-4xl font-extrabold mb-1">{s.value}</div>
                <div className="text-amber-100 text-sm font-medium uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ways to get involved */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 space-y-6">
          {WAYS.map((w, i) => (
            <div key={w.title} className={`rounded-3xl border overflow-hidden ${
              w.accent ? 'bg-amber-500 border-amber-500' : 'bg-white border-gray-100 shadow-sm'
            }`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                {/* Left */}
                <div className="p-8 lg:p-10">
                  <div className="text-4xl mb-4">{w.emoji}</div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${w.accent ? 'text-amber-100' : 'text-amber-600'}`}>
                    {w.subtitle}
                  </p>
                  <h2 className={`text-3xl font-extrabold mb-4 ${w.accent ? 'text-white' : 'text-gray-900'}`}>
                    {w.title}
                  </h2>
                  <p className={`leading-relaxed mb-6 ${w.accent ? 'text-amber-50' : 'text-gray-500'}`}>
                    {w.body}
                  </p>
                  <Link href={w.href}
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-colors ${
                      w.accent
                        ? 'bg-white text-amber-600 hover:bg-amber-50'
                        : 'bg-amber-500 text-white hover:bg-amber-600'
                    }`}>
                    {w.cta}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                </div>

                {/* Right — perks */}
                <div className={`p-8 lg:p-10 flex flex-col justify-center ${
                  w.accent ? 'bg-amber-600/30' : 'bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-100'
                }`}>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-4 ${w.accent ? 'text-amber-200' : 'text-gray-400'}`}>
                    What you get
                  </p>
                  <ul className="space-y-3">
                    {w.perks.map(perk => (
                      <li key={perk} className={`flex items-start gap-3 text-sm ${w.accent ? 'text-amber-50' : 'text-gray-600'}`}>
                        <span className={`mt-0.5 shrink-0 font-bold ${w.accent ? 'text-white' : 'text-amber-500'}`}>✓</span>
                        {perk}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Community quote */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-5xl mb-6">😊</div>
          <blockquote className="text-2xl font-bold text-gray-900 leading-snug mb-4">
            "The people who shape Smileys are the ones who show up."
          </blockquote>
          <p className="text-gray-500 mb-10">
            Every host, every club leader, every member who invites a friend — you're not just attending a community.
            You're building one.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/apply" className="btn-primary--lg">Apply to join</Link>
            <Link href="/contact" className="btn-secondary">Get in touch</Link>
          </div>
        </div>
      </section>

    </main>
  )
}
