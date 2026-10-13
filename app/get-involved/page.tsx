import type { Metadata } from 'next'
import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { getSession } from '@/lib/session'
import { isClubHost, hostCityIds } from '@/lib/access'
import HostPath from '@/components/HostPath'
import PageViewTracker from '@/components/PageViewTracker'
import { loadContent } from '@/lib/content'
import { getCommunityStats, approx, eventsStat } from '@/lib/communityStats'
import { resolveCityForPage, cityQs, type CitySearch } from '@/lib/cityPageParam'

// Per city like the other hubs: the metadata was title + description only,
// so a shared link previewed (and credited) the homepage, the page had no
// canonical (every ?city= variant indexable), and it promised "the most
// vibrant social community in your city" to cities with no members yet.
export async function generateMetadata({ searchParams }: { searchParams?: Promise<CitySearch> }): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const title       = 'Get Involved — Smileys Community'
  const description = `Host events, start a club, invite friends or share your story — how members shape Smileys${city.slug === DEFAULT_CITY_SLUG ? '' : ` in ${city.name}`}.`
  const image = `${APP_URL}/api/og?${new URLSearchParams({ title: 'Get involved', eyebrow: 'Smileys Community', cta: 'Host · Start a club · Invite' }).toString()}`
  return {
    title, description,
    alternates: { canonical: `${APP_URL}/get-involved` },
    openGraph: { title, description, url: `${APP_URL}/get-involved`, images: [{ url: image, width: 1200, height: 630, alt: 'Get involved with Smileys' }] },
    twitter:   { card: 'summary_large_image', title, description, images: [image] },
  }
}

// What each way really gives you — every line here is something the product
// does. The perks promised a supplier network, a directory listing for clubs
// (the directory is businesses), a WhatsApp group the platform creates (it
// stores a link), and "a warm introduction to your clubs" for invited friends
// (nothing does that).
type Way = { key: 'host' | 'club' | 'invite' | 'story'; emoji: string; title: string; subtitle: string; body: string; perks: string[] }
const WAYS: Way[] = [
  {
    key: 'host',
    emoji: '🎉',
    title: 'Host an event',
    subtitle: 'Share your passion with the community',
    // It promised matching members to events, a feature that doesn't exist.
    body: 'Have an idea for a dinner, a hike, a cultural visit, a language exchange? Hosts are the heartbeat of Smileys. You bring the concept — we handle the platform, the RSVPs and the door.',
    perks: [
      'Event tools — RSVPs, guest lists, waitlists and check-in at the door',
      'Link your event to a venue from the Smileys directory',
      'Your event in front of the members of your city',
      'The Host title on your profile and your city\'s Meet the Hosts page',
    ],
  },
  {
    key: 'club',
    emoji: '⬡',
    title: 'Start a club',
    subtitle: 'Build your own community within the community',
    body: 'Got a niche interest that doesn\'t have a home yet? Sailing, chess, French cinema, cold plunges — if it\'s your thing, chances are it\'s someone else\'s too. Propose a club and our team will help you set it up.',
    perks: [
      'Your own club page with member management',
      'Your club\'s group-chat link on its page, set up with our team',
      'Tools to organize recurring events and activities',
      'Listed on your city\'s Clubs page',
    ],
  },
  {
    key: 'invite',
    emoji: '✉️',
    title: 'Invite a friend',
    subtitle: 'The community grows one great person at a time',
    body: 'Smileys is curated by design — every new member is reviewed personally. The best way to bring great people in is through the people already here. Your invite carries your reputation.',
    perks: [
      'Your referral is noted during the application review',
      'Help shape what kind of community Smileys becomes',
    ],
  },
  {
    key: 'story',
    emoji: '📰',
    title: 'Share your story',
    subtitle: 'Your words on the Stories wall',
    body: 'The pages that convince someone to join aren\'t written by us — they\'re written by members. How you found your people, a club that changed your week, a night that turned strangers into friends. We review every story and publish the best under your name.',
    perks: [
      'Published under your name in Stories (visitors who aren\'t members see your first name)',
      'New stories appear on your city\'s page and the homepage',
      'We polish the formatting — the voice stays yours',
    ],
  },
]

// Measured numbers only, like /about and /why (2026-09-29): the shared
// editorial rows showed "1,000+ events since 2023" against 318 on the
// platform, and a reorder would have put "4,000+ WhatsApp reach" here.

export default async function GetInvolvedPage({ searchParams }: { searchParams?: Promise<CitySearch> }) {
  const c          = loadContent()
  const gi         = c.get_involved ?? {}
  const s          = await getCommunityStats()
  const STATS      = [
    { value: approx(s.members), label: 'Members across Smileys' },
    eventsStat(s.events),
    { value: approx(s.clubs),   label: 'Active clubs' },
  ]
  // The city the reader came from (a city's hosts page or Meet your hosts
  // section links here with ?city=), so "Meet the Hosts" leads back to that
  // city's roster and the path names the city — the round trip from
  // /izmir/hosts used to end on Istanbul's page.
  const { city } = await resolveCityForPage(searchParams)
  const qs = cityQs(city.slug)
  // Who is reading decides where each way leads. Everyone got the same four
  // links: a guest was sent to two member-only pages (a blank page, then the
  // login screen), a host was asked to "apply to become a host", and a member
  // was told to "Apply to join".
  const session = await getSession()
  const hosting = !!session && (session.role === 'admin' || await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0)
  const withCity = (topic: string) => `/contact?topic=${topic}${city.slug === DEFAULT_CITY_SLUG ? '' : `&city=${city.slug}`}`
  const cta: Record<Way['key'], { label: string; href: string }> = {
    // Hosting and running a club are for members: a guest's offer reached
    // the team only to be told to apply first. Guests go to the application.
    host:   hosting ? { label: 'Plan your next event', href: '/host/events/new' }
          : session ? { label: 'Offer to host', href: withCity('host') }
          :           { label: 'Apply to host', href: `/apply${qs}` },
    club:   session ? { label: 'Propose a club', href: withCity('club-proposal') } : { label: 'Apply to start a club', href: `/apply${qs}` },
    invite: session ? { label: 'Invite someone', href: '/invite' } : { label: 'Join to invite friends', href: `/apply${qs}` },
    story:  session ? { label: 'Write your story', href: '/share-story' } : { label: 'Join to share your story', href: `/apply${qs}` },
  }
  const headline = gi.headline?.trim() || 'Help build the community you want to be part of'
  const subtitle = gi.subtitle?.trim() || 'Smileys is shaped by its members. The best events, the most active clubs, the warmest atmosphere — they all start with someone deciding to show up and contribute.'
  return (
    <div className="min-h-screen bg-warm">
      <PageViewTracker event="get_involved_page_view" />

      {/* Hero — same shape as /partner-with-us and /advertise. */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-4">Get involved</p>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-5">
            {headline}
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto mb-8">
            {subtitle}
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <a href="#host"
              className="px-7 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm text-center transition-colors">
              Host an event
            </a>
            <a href="#invite"
              className="px-7 py-3.5 rounded-xl border border-gray-300 text-gray-800 font-semibold text-sm text-center hover:bg-gray-50 transition-colors">
              Invite a friend
            </a>
          </div>
        </div>
      </section>

      {/* Stats — a dl so screen readers pair each label with its number, as
          on /about, /why and /advertise. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-14">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STATS.map(st => (
              <div key={st.label} className="flex flex-col-reverse gap-1 rounded-xl bg-amber-50/60 p-4">
                <dt className="text-xs font-bold uppercase tracking-wide text-amber-700">{st.label}</dt>
                <dd className="text-3xl font-extrabold text-gray-900">{st.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Ways to get involved — four equal cards, none promoted over another. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Four ways to shape Smileys</h2>
        <p className="text-gray-600 max-w-2xl mb-8">
          Pick the one that fits how much time you have. Each starts with a single step.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {WAYS.map(w => (
            <div key={w.title} id={w.key} className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 flex flex-col scroll-mt-24">
              <div aria-hidden="true" className="text-2xl mb-2">{w.emoji}</div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">{w.subtitle}</p>
              <h3 className="text-xl font-extrabold text-gray-900 mb-2">{w.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-4">{w.body}</p>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">What you get</p>
              <ul className="space-y-2 mb-5">
                {w.perks.map(perk => (
                  <li key={perk} className="flex items-start gap-2 text-sm text-gray-600">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 font-bold text-amber-500">✓</span>
                    {perk}
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Link href={cta[w.key].href}
                  className="block text-center px-5 py-3 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors">
                  {cta[w.key].label}
                </Link>
                {!session && (w.key === 'host' || w.key === 'club') && (
                  <p className="text-xs mt-3 text-gray-500">
                    Hosts and club founders are members first — apply, and once you&apos;re in, tell us what you&apos;d run.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* The path: Host, then City Lead (lib/hostTitles) */}
      <section className="bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <HostPath cityName={city.name} />
          <p className="text-sm text-gray-600 mt-4">
            Every host and lead is a member volunteering their time. See who holds the titles today on the{' '}
            <Link href={`/hosts${cityQs(city.slug)}`} className="font-semibold text-amber-700 underline">Meet the Hosts</Link> page.
          </p>
        </div>
      </section>

      {/* Organizations: this page is for members, so signpost the two pages
          that are for businesses and event organizers. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">For businesses and event organizers</h2>
        <p className="text-gray-600 max-w-2xl mb-8">
          Not a member, but you run an event or a business in the city? There are two separate routes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
            <div aria-hidden="true" className="text-2xl mb-2">🤝</div>
            <h3 className="font-bold text-gray-900 mb-1">Partner with us</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              Editorial coverage, interviews and event collaborations for international audiences. Independent, and not for sale.
            </p>
            <Link href="/partner-with-us" className="text-sm font-semibold text-amber-700 underline">See how partnerships work</Link>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
            <div aria-hidden="true" className="text-2xl mb-2">📢</div>
            <h3 className="font-bold text-gray-900 mb-1">Advertise with us</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              Paid placement: event sponsorship, newsletter features, club partnerships and branded events.
            </p>
            <Link href="/advertise" className="text-sm font-semibold text-amber-700 underline">See advertising options</Link>
          </div>
        </div>
      </section>

      {/* Our own line, not a member's words: it was set as a quotation with
          no speaker, which read as a testimonial nobody gave. */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 text-center">
          <div aria-hidden="true" className="text-4xl mb-4">😊</div>
          <h2 className="text-2xl font-extrabold text-gray-900 leading-snug mb-3">
            The people who shape Smileys are the ones who show up.
          </h2>
          <p className="text-gray-600 mb-8">
            Every host, every club leader, every member who invites a friend — you&apos;re not just attending a community.
            You&apos;re building one.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {/* A member is already in: they get the next thing to do. */}
            {session
              ? <Link href="/invite" className="btn-primary--lg">Invite a friend</Link>
              : <Link href={`/apply${qs}`} className="btn-primary--lg">Apply to join</Link>}
            <Link href={`/contact${city.slug === DEFAULT_CITY_SLUG ? '' : `?city=${city.slug}`}`} className="btn-secondary">Get in touch</Link>
          </div>
        </div>
      </section>

    </div>
  )
}
