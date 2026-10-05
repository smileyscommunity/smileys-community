import type { Metadata } from 'next'
import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { getSession } from '@/lib/session'
import { isClubHost, hostCityIds } from '@/lib/access'
import HostPath from '@/components/HostPath'
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
type Way = { key: 'host' | 'club' | 'invite' | 'story'; emoji: string; title: string; subtitle: string; body: string; perks: string[]; accent: boolean }
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
    accent: true,
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
    accent: false,
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
    accent: false,
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
    accent: false,
  },
]

import { loadContent } from '@/lib/content'


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
    <div>

      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-8">
            <span aria-hidden="true">✦</span> Get involved
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-tight mb-6">
            {headline}
          </h1>
          <p className="text-base text-gray-600 max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        </div>
      </section>

      {/* Stats — dark text on the amber (white and amber-100 read at about
          2:1), and a dl so screen readers pair each label with its number,
          as on /about and /why. */}
      <section className="bg-amber-500">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 text-center text-amber-950">
            {STATS.map(st => (
              <div key={st.label} className="flex flex-col-reverse gap-1">
                <dt className="text-amber-950 text-sm font-medium uppercase tracking-wider">{st.label}</dt>
                <dd className="text-5xl md:text-4xl font-extrabold">{st.value}</dd>
              </div>
            ))}
          </dl>
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
                  <div aria-hidden="true" className="text-4xl mb-4">{w.emoji}</div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${w.accent ? 'text-amber-950' : 'text-amber-600'}`}>
                    {w.subtitle}
                  </p>
                  <h2 className={`text-3xl font-extrabold mb-4 text-gray-900`}>
                    {w.title}
                  </h2>
                  <p className={`leading-relaxed mb-6 ${w.accent ? 'text-amber-950' : 'text-gray-600'}`}>
                    {w.body}
                  </p>
                  <Link href={cta[w.key].href}
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-colors ${
                      w.accent
                        ? 'bg-white text-amber-600 hover:bg-amber-50'
                        : 'bg-amber-500 text-white hover:bg-amber-600'
                    }`}>
                    {cta[w.key].label}
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                  {!session && (w.key === 'host' || w.key === 'club') && (
                    <p className={`text-xs mt-3 ${w.accent ? 'text-amber-950' : 'text-gray-500'}`}>
                      Hosts and club founders are members first — apply, and once you&apos;re in, tell us what you&apos;d run.
                    </p>
                  )}
                </div>

                {/* Right — perks */}
                <div className={`p-8 lg:p-10 flex flex-col justify-center ${
                  w.accent ? 'bg-amber-600/30' : 'bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-100'
                }`}>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-4 ${w.accent ? 'text-amber-950' : 'text-gray-500'}`}>
                    What you get
                  </p>
                  <ul className="space-y-3">
                    {w.perks.map(perk => (
                      <li key={perk} className={`flex items-start gap-3 text-sm ${w.accent ? 'text-amber-950' : 'text-gray-600'}`}>
                        <span aria-hidden="true" className={`mt-0.5 shrink-0 font-bold ${w.accent ? 'text-amber-950' : 'text-amber-500'}`}>✓</span>
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

      {/* The path: Host, then City Lead (lib/hostTitles) */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <HostPath cityName={city.name} />
          <p className="text-sm text-gray-500 mt-4">
            Every host and lead is a member volunteering their time. See who holds the titles today on the{' '}
            <Link href={`/hosts${cityQs(city.slug)}`} className="font-semibold text-amber-600 hover:underline">Meet the Hosts</Link> page.
          </p>
        </div>
      </section>

      {/* Community quote */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          {/* Our own line, not a member's words: it was set as a quotation with
              no speaker, which read as a testimonial nobody gave. */}
          <div aria-hidden="true" className="text-5xl mb-6">😊</div>
          <h2 className="text-2xl font-bold text-gray-900 leading-snug mb-4">
            The people who shape Smileys are the ones who show up.
          </h2>
          <p className="text-gray-600 mb-10">
            Every host, every club leader, every member who invites a friend — you're not just attending a community.
            You're building one.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
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
