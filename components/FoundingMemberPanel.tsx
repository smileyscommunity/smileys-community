import Link from 'next/link'

// Shown to a member whose city is still SEEDING (see lib/cityMaturity) — the
// handful of people in a just-launched city. An Istanbul-shaped dashboard
// hands them empty event/club grids, which reads as a dead community and is
// the fastest way to lose the exact people a new city can't afford to lose.
//
// This reframes the emptiness as what it actually is: they're early, and the
// founders shape the place. So instead of "here's what's on" (nothing), the
// asks are the three things that actually build a city — host the first
// thing, bring people, tell us what it should be. No vanity metric: the rank
// is a real position, and every CTA is an action toward real-life connection.
//
// Deliberately not rendered once a city crosses into `forming` — at that
// point there's genuine activity to show and this would get in its way.
export default function FoundingMemberPanel({
  cityName, rank, total, firstName,
}: {
  cityName: string
  rank: number          // this member's join position in the city (1-based)
  total: number         // approved members in the city so far
  firstName: string
}) {
  // "one of the first N" reads honestly whether they're #2 or #40; the exact
  // rank is shown when they're genuinely among the very first, where it lands.
  const ordinal =
    rank === 1 ? 'the first member' :
    rank <= 10 ? `member #${rank}` :
                 `one of the first ${total}`

  const asks = [
    { href: '/host',    emoji: '🎤', title: 'Host the first thing',
      body: `A walk, a dinner, a coffee — ${cityName} starts with one gathering. It doesn't have to be big.` },
    { href: '/invite',  emoji: '👋', title: 'Bring people you know',
      body: `The founders bring the founders. Someone you'd want at that first dinner is the right person to invite.` },
    { href: '/contact', emoji: '💬', title: `Tell us what ${cityName} needs`,
      body: `You know this city better than we do. What should Smileys ${cityName} be? We're listening.` },
  ]

  return (
    <section className="mb-6 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white overflow-hidden">
      <div className="px-5 sm:px-8 pt-6 pb-5">
        <p className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mb-1">Founding member</p>
        <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
          {firstName}, you&apos;re {ordinal} in {cityName}.
        </h2>
        <p className="text-sm text-gray-600 mt-2 max-w-2xl">
          Smileys {cityName} is just getting started — which means the first events, the first clubs,
          the whole feel of it get shaped by the people here now. That&apos;s you. It&apos;ll look quiet
          for a little while; that&apos;s the founding stage, not a dead end.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-px bg-amber-100">
        {asks.map(a => (
          <Link key={a.href} href={a.href}
            className="group bg-gradient-to-br from-amber-50 to-white hover:from-amber-100 px-5 py-4 transition-colors">
            <div className="text-xl mb-1.5">{a.emoji}</div>
            <p className="text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{a.title}</p>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">{a.body}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
