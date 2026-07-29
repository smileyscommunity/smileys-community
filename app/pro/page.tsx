import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import ProWaitlistForm from './ProWaitlistForm'

export const dynamic = 'force-dynamic'

const FOUNDER_CAP = 100

export const metadata = {
  alternates: { canonical: `${APP_URL}/pro` },
  title: 'Smileys Pro — The Professional Network for Istanbul\'s Internationals',
  description: 'A vetted professional network on top of the community you already trust. Founding membership opens at launch — reserve your spot.',
  openGraph: {
    title: 'Smileys Pro — Coming Soon',
    description: 'A vetted professional network on top of the community you already trust. Founding membership: 50% off for life.',
    url: `${APP_URL}/pro`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smileys Pro — Coming Soon',
    description: 'A vetted professional network on top of the community you already trust. Founding membership: 50% off for life.',
  },
}

const BENEFITS = [
  {
    emoji: '🎯',
    title: 'Filter by industry and role',
    body:  'Find the marketing lead, the founder, the designer, the recruiter — without scrolling through 4,000 hobby tags.',
  },
  {
    emoji: '✉️',
    title: 'Structured intro requests',
    body:  'Skip the awkward cold DM. Send a one-tap intro with context, and let people accept or pass cleanly — both sides save face.',
  },
  {
    emoji: '⚡',
    title: 'Priority access to Pro events',
    body:  'Quarterly founder dinners, partner-hosted workshops, and curated mixers where the room is built around your industry.',
  },
  {
    emoji: '🪪',
    title: 'A profile that means business',
    body:  'Your professional title, what you\'re building, what you\'re hiring for — surfaced where members already meet, not buried in a CV.',
  },
]

const FAQ = [
  {
    q: 'When does Pro launch?',
    a: 'When we have 100 founding members on the waitlist. Founders lock in the founder rate and a permanent badge — both expire the moment we open public pricing.',
  },
  {
    q: 'Is this replacing the community?',
    a: 'No. Smileys stays exactly what it is — Sailing, Games, Coffee, dinners, friendships. Pro is an optional layer for members who also want curated professional connections.',
  },
  {
    q: 'What does it cost after the founder rate?',
    a: 'Public pricing will be set when Pro opens. Founding members lock in 50% off for life, no matter where public pricing lands.',
  },
  {
    q: 'Can non-members join the waitlist?',
    a: 'Yes — the waitlist is open to anyone. Pro membership at launch will require an active Smileys membership, so apply to the community in parallel.',
  },
]

export default async function ProPage() {
  const [session, count] = await Promise.all([
    getSession(),
    prisma.proWaitlistEntry.count(),
  ])
  const foundersRemaining = Math.max(0, FOUNDER_CAP - count)
  const onWaitlist = session ? !!(await prisma.proWaitlistEntry.findUnique({
    where: { email: session.email.toLowerCase() },
  })) : false

  return (
    <main className="bg-zinc-950 text-white">
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-white/5">
        {/* Glow gradient — premium, gold-on-black, distinct from the
            community's amber-on-warm light theme. Pro reads as different.
            Pointer-events-none so links underneath stay clickable. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.15),transparent_60%)] pointer-events-none" />
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-400 text-[11px] font-bold tracking-widest uppercase mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Coming soon — founding membership open
          </div>

          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight leading-[0.95] mb-6">
            The room your<br />
            <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400 bg-clip-text text-transparent">career has been waiting for.</span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 max-w-xl leading-relaxed mb-10">
            Smileys built the most trusted social community for internationals in Istanbul.<br />
            <span className="text-white font-semibold">Smileys Pro</span> is the professional layer on top —
            curated, member-only, and built for people who want to meet other operators, founders, and creatives without the LinkedIn theatre.
          </p>

          {/* Founder counter — scarcity. Live count + remaining spots
              compute on every request so the urgency is real. */}
          <div className="inline-flex items-stretch rounded-2xl overflow-hidden border border-white/10 bg-white/5 backdrop-blur mb-10">
            <div className="px-5 py-3 border-r border-white/10">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Founding members</div>
              <div className="text-2xl font-extrabold tabular-nums">{count}<span className="text-zinc-600">/{FOUNDER_CAP}</span></div>
            </div>
            <div className="px-5 py-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Founder rate</div>
              <div className="text-2xl font-extrabold text-amber-400">50% off <span className="text-zinc-500 font-medium text-sm">for life</span></div>
            </div>
          </div>

          <ProWaitlistForm
            initialEmail={session?.email ?? ''}
            initialName={session?.name ?? ''}
            alreadyJoined={onWaitlist}
            foundersRemaining={foundersRemaining}
          />

          <p className="text-xs text-zinc-500 mt-6">
            Founders lock in 50% off forever and a permanent <span className="font-semibold text-amber-400">Founder</span> badge. When the {FOUNDER_CAP}th founder joins, public pricing opens.
          </p>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="mb-14">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">What you'll get</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold max-w-2xl leading-tight">
              Built for the professional half of you — without losing the rest.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {BENEFITS.map(b => (
              <div key={b.title} className="bg-white/5 border border-white/10 rounded-2xl p-7 hover:bg-white/[0.07] transition-colors">
                <div className="text-3xl mb-4">{b.emoji}</div>
                <h3 className="text-lg font-bold mb-2">{b.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — soft sketch, not feature list */}
      <section className="border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {[
              { n: '01', t: 'Reserve your seat',     b: 'Join the waitlist. Founders get a personal note and a 7-day window to accept when Pro opens.' },
              { n: '02', t: 'We curate the rooms',   b: 'Pro events and intro pools are seeded with vetted operators and creatives across industries.' },
              { n: '03', t: 'Meet on your terms',    b: 'Use the social side for friendships, the Pro side for work. No cross-contamination, no awkward DMs.' },
            ].map(s => (
              <div key={s.n}>
                <div className="text-amber-400 font-mono text-sm font-bold mb-3">{s.n}</div>
                <h3 className="text-xl font-bold mb-2">{s.t}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <h2 className="text-3xl font-extrabold mb-10">Questions</h2>
          <div className="space-y-6">
            {FAQ.map(f => (
              <div key={f.q} className="border-b border-white/5 pb-6 last:border-b-0">
                <h3 className="font-bold text-white mb-2">{f.q}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <h2 className="text-4xl sm:text-5xl font-extrabold mb-6 leading-tight">
            {foundersRemaining > 0
              ? <>Only <span className="text-amber-400">{foundersRemaining}</span> founding spots left.</>
              : <>The founding cohort is full — join the public waitlist.</>}
          </h2>
          <a href="#join" className="inline-block px-8 py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors">
            Reserve your spot →
          </a>
          <p className="text-xs text-zinc-500 mt-6">
            <Link href="/" className="hover:text-zinc-300">← Back to Smileys</Link>
          </p>
        </div>
      </section>
    </main>
  )
}
