import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import Image from 'next/image'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getNeighborhoodView, getNeighborhoodViews, type NeighborhoodView } from '@/lib/neighborhoodsDb'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'
import { countryName } from '@/lib/countries'
import { APP_URL } from '@/lib/env'
import MapSection from '@/components/MapSection'
import SocialShare from '@/components/SocialShare'
import { getSession } from '@/lib/session'
import type { Metadata } from 'next'
import HeroStats from './HeroStats'
import NeighborhoodSections from './NeighborhoodSections'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const cityId = await resolveCityId(await getSession())
  const city   = await getCityConfig(cityId)
  const meta   = await getNeighborhoodView(cityId, slug)
  if (!meta) return {}
  const name  = meta.name
  const guide = loadNeighborhoodGuide(city.slug, slug)

  // 89 of 103 neighborhoods have real, hand-authored place content (named
  // venues, addresses, tips — see buildAboutCopy's comment on why the other
  // 14 don't get invented specifics). That content never reached the title/
  // description Google actually indexes — every page used the same "Social
  // Events" template regardless, so none of them targeted "things to do in
  // X" search intent despite having the material to. Pull a few real place
  // names in when they exist; fall back to the old generic copy otherwise.
  const topPlaces: string[] = guide?.places
    ? guide.places.flatMap((cat: { items?: { name: string }[] }) => cat.items?.map(it => it.name) ?? []).slice(0, 2)
    : []

  const title = guide?.tagline
    ? `${meta.emoji} ${name}: Things to Do & Local Guide · Smileys Community`
    : `${meta.emoji} ${name} — Social Events in ${city.name} · Smileys Community`
  // Taglines run 79-199 chars on their own (avg 150), so a raw concat with
  // place names routinely blew past Google's ~155-160 char display budget.
  // Brand mention is dropped here — it's already in the title, and every
  // char here is better spent on the "things to do" content Google needs
  // to match search intent. Hard-capped as a safety net for the longest
  // taglines even after dropping the brand sentence.
  const rawDesc = guide?.tagline
    ? `${guide.tagline}${topPlaces.length ? ` Try ${topPlaces.join(', ')}.` : ''}`
    : `Discover upcoming social events in ${name}, ${city.name}. ${meta.vibe}. Join Smileys Community — ${city.name}'s expat & digital nomad social platform.`
  const desc = rawDesc.length > 160
    ? `${rawDesc.slice(0, 157).replace(/\s+\S*$/, '').trimEnd()}…`
    : rawDesc
  const url = `${APP_URL}/neighborhoods/${slug}`
  // A page-level `openGraph` block loses the root layout's default
  // og:image (Next.js doesn't deep-merge nested metadata) — see
  // app/about/page.tsx. Without this every neighborhood page shared with
  // no preview at all on WhatsApp/iMessage/Twitter.
  const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
    title:   `${meta.emoji} ${name}`,
    eyebrow: `${city.name} Neighborhoods · Smileys Community`,
    cta:     'See events here',
  }).toString()}`
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      title, description: desc, url, siteName: 'Smileys Community', type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${name} — Smileys Community` }],
    },
    twitter: { card: 'summary_large_image', title, description: desc, images: [ogImage] },
  }
}

// Keyed by Istanbul's area vocabulary; any other city's grouping falls through
// to the default. Areas are per-city free text (see NeighborhoodView.area), so
// this is a lookup with a fallback, never an exhaustive map.
const SIDE_GRADIENTS: Record<string, string> = {
  Central:  'from-amber-600 via-orange-500 to-yellow-500',
  European: 'from-blue-700 via-indigo-600 to-violet-600',
  Asian:    'from-emerald-600 via-teal-500 to-cyan-500',
  Coastal:  'from-sky-600 via-blue-500 to-indigo-500',
  Islands:  'from-purple-600 via-pink-500 to-rose-500',
  Emerging: 'from-gray-700 via-slate-600 to-gray-500',
}

// Per-city editorial content, namespaced by city slug. The default city keeps
// its 103 files at the flat legacy path (data/neighborhoods/moda.json) — moving
// them would break nothing but is churn for no gain; every other city writes to
// data/neighborhoods/<city>/<slug>.json. The namespacing is the point: slugs
// are only unique WITHIN a city, so a flat lookup would eventually serve
// Istanbul's copy on another city's identically-named district.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadNeighborhoodGuide(citySlug: string, slug: string): any | null {
  const paths = citySlug === DEFAULT_CITY_SLUG
    ? [join(process.cwd(), 'data', 'neighborhoods', `${slug}.json`)]
    : [join(process.cwd(), 'data', 'neighborhoods', citySlug, `${slug}.json`)]
  for (const file of paths) {
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { /* next */ }
  }
  return null
}

const COST_LABEL: Record<number, string> = { 1: 'budget-friendly', 2: 'mid-range', 3: 'upscale' }

// Naturally-prepositioned phrase per Istanbul side — sideLabel.toLowerCase()
// alone produced grammatically odd sentences ("on the central istanbul", "on
// the coastal istanbul") for some sides, since "on the X" only scans for a
// handful of the six categories. Other cities have their own area names and
// no hand-written phrasing, so they get the neutral "in <city>" form rather
// than a guessed preposition.
const SIDE_PHRASE: Record<string, string> = {
  Central:  "in central Istanbul",
  European: 'on the European side',
  Asian:    'on the Asian side',
  Coastal:  "along Istanbul's coast",
  Emerging: "in one of Istanbul's emerging districts",
  Islands:  "on the Prince's Islands",
}

// The 14 (of 103) neighborhoods with no hand-authored guide.json had nothing
// but dynamic member/event lists — often empty for smaller areas, i.e. thin
// content. This gives every neighborhood a genuine, non-duplicate paragraph
// built only from real structured data (side, cost tier, vibe, nearest
// areas) — no invented specifics (restaurant names etc.) that would need an
// actual local's input to be true. Every clause is skipped when its data is
// missing: a city that hasn't filled in vibes or areas gets a shorter true
// sentence, never "one of Izmir's  neighborhoods, undefined".
function buildAboutCopy(meta: NeighborhoodView, cityName: string, nearbyNames: string[]): string {
  const { name, vibe, area, cost } = meta
  const where = SIDE_PHRASE[area] ?? (area ? `in ${area}` : `in ${cityName}`)
  const priced = COST_LABEL[cost] ? `, generally ${COST_LABEL[cost]} by local standards` : ''
  const opener = vibe
    ? `${name} is one of ${cityName}'s ${vibe.toLowerCase()} neighborhoods, ${where}${priced}.`
    : `${name} is a neighborhood ${where}${priced}.`
  const near = nearbyNames.length > 0 ? ` It's close to ${nearbyNames.join(' and ')}.` : ''
  return `${opener}${near} Smileys members based in ${name} connect through neighborhood events, meetups, and each other — this page tracks who's around, what's on, and what's nearby.`
}

// Nearest-neighbors within the same area (mirrors the "Also on the side" list
// computed later in NeighborhoodSections). Reads the city's own registry — the
// 60s-cached list the page already resolved its own neighborhood from, so this
// costs nothing extra.
function nearestNeighborhoods(meta: NeighborhoodView, siblings: NeighborhoodView[], take: number): Array<{ name: string; slug: string }> {
  if (!meta.area) return []
  return siblings
    .filter(n => n.area === meta.area && n.name !== meta.name)
    .slice(0, take)
    .map(n => ({ name: n.name, slug: n.slug }))
}

// Skeleton shown while NeighborhoodSections streams in
function ContentSkeleton() {
  return (
    <div className="space-y-14 animate-pulse">
      {/* Wall skeleton */}
      <div className="bg-white border border-gray-100 rounded-2xl h-48 shadow-sm" />
      {/* Members skeleton */}
      <div>
        <div className="h-3 bg-gray-100 rounded w-28 mb-5" />
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <div className="flex flex-wrap gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="w-12 h-12 rounded-full bg-gray-200" />
                <div className="h-2 bg-gray-100 rounded w-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Events skeleton */}
      <div>
        <div className="h-3 bg-gray-100 rounded w-32 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="h-40 bg-gray-200" />
              <div className="p-4 space-y-2">
                <div className="h-2.5 bg-gray-100 rounded w-1/3" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'

export default async function NeighborhoodPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSession() // fast JWT decode, no DB

  // The slug resolves against the VIEWER'S city, not a hardcoded Istanbul
  // list — that list is why /neighborhoods/alsancak 404'd for an İzmir member
  // while their own city page linked to it. Both the registry and the city
  // config are 60s-cached in module memory, so this stays cheap.
  const cityId   = await resolveCityId(session)
  const city     = await getCityConfig(cityId)
  const siblings = await getNeighborhoodViews(cityId)
  const meta     = siblings.find(n => n.slug === slug)
  if (!meta) notFound()

  const name  = meta.name
  const guide = loadNeighborhoodGuide(city.slug, slug)

  const isYourNeighborhood = session?.neighborhood === name
  const hasNoNeighborhood  = session && !session.neighborhood
  const isStaff = session?.role === 'admin' || session?.role === 'moderator'

  // Istanbul's six areas have hand-written display labels; another city's area
  // renders under its own name. Consumers must read this through
  // `sideLabel[area] ?? area`, never assume a hit.
  const sideLabel: Record<string, string> = {
    Central:  'Central Istanbul',
    European: 'European Side',
    Asian:    'Asian Side',
    Coastal:  'Coastal Istanbul',
    Emerging: 'Emerging District',
    Islands:  "Prince's Islands",
  }

  const subtitle = [meta.vibe, meta.area ? (sideLabel[meta.area] ?? meta.area) : ''].filter(Boolean).join(' · ')

  const nearestForAbout = nearestNeighborhoods(meta, siblings, 2)
  const aboutCopy = buildAboutCopy(meta, city.name, nearestForAbout.map(n => n.name))
  const pageUrl = `${APP_URL}/neighborhoods/${slug}`

  // Read the per-request CSP nonce set by middleware so the JSON-LD <script>
  // tags aren't blocked under 'strict-dynamic' (same pattern as the handbook
  // article / event detail / FAQ JSON-LD).
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',          item: APP_URL },
      { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${APP_URL}/neighborhoods` },
      { '@type': 'ListItem', position: 3, name,                  item: pageUrl },
    ],
  }
  const placeJsonLd = {
    '@context':   'https://schema.org',
    '@type':      'Place',
    name:         `${name}, ${city.name}`,
    description:  aboutCopy,
    url:          pageUrl,
    // Omitted rather than zeroed when the city hasn't filled in coordinates:
    // 0,0 is the Gulf of Guinea, and telling a crawler that is worse than
    // telling it nothing.
    ...(meta.lat && meta.lon
      ? { geo: { '@type': 'GeoCoordinates', latitude: meta.lat, longitude: meta.lon } }
      : {}),
    containedInPlace: {
      '@type': 'City',
      name:    city.name,
      containedInPlace: { '@type': 'Country', name: countryName(city.country) },
    },
  }

  return (
    <main>
      <script
        type="application/ld+json"
        nonce={nonce}
        // JSON.stringify doesn't escape `<`, so a literal `</script>` in any
        // interpolated value would break out of this tag — escape `<` plus
        // the unicode line separators (same guard as the other JSON-LD
        // blocks: handbook article, event detail, FAQ, Organization).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029'),
        }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(placeJsonLd)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029'),
        }}
      />
      {/* ── Hero — renders immediately, no DB ── */}
      <section className="relative overflow-hidden">
        {guide?.image ? (
          <div className="absolute inset-0">
            <Image src={guide.image} alt={name} fill className="object-cover" sizes="100vw" priority
              style={{ objectPosition: `center ${guide.imagePosition ?? 50}%` }} />
            <div className="absolute inset-0 bg-black/50" />
          </div>
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${SIDE_GRADIENTS[meta.area] ?? 'from-amber-500 to-orange-500'}`}>
            <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center opacity-10 text-[160px] select-none pointer-events-none">
              {meta.emoji}
            </div>
          </div>
        )}

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <Link href="/neighborhoods" className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors mb-8">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All neighborhoods
          </Link>

          <div className="flex items-center gap-3 mb-2">
            {/* Keyword-descriptive H1 for "istanbul neighborhoods"-type search
                intent — the name stays visually dominant (large, first), the
                rest reads as a natural subtitle rather than SEO boilerplate. */}
            <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight drop-shadow-sm">
              <span aria-hidden="true">{meta.emoji}</span> {name}, {city.name}
              <span className="block text-lg sm:text-xl font-semibold text-white/70 mt-1">
                A neighborhood guide for the Smileys community
              </span>
            </h1>
            {isYourNeighborhood && (
              <span className="text-xs font-bold bg-white/20 text-white px-2.5 py-1 rounded-full backdrop-blur-sm shrink-0 self-start mt-1">Your area</span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* Only the parts the city actually filled in — an unfilled vibe or
                area used to render a bare " · " separator. */}
            {subtitle && <p className="text-white/75 text-sm font-medium">{subtitle}</p>}
            <span className="text-xs font-semibold bg-white/15 backdrop-blur-sm text-white px-2 py-0.5 rounded-full">
              <span aria-hidden="true">{meta.cost === 1 ? '💰' : meta.cost === 2 ? '💰💰' : '💰💰💰'}</span>{' '}
              {meta.cost === 1 ? 'Affordable' : meta.cost === 2 ? 'Mid-range' : 'Pricey'}
            </span>
          </div>

          {guide?.tagline && (
            <p className="text-white/60 mt-3 text-sm max-w-xl leading-relaxed">{guide.tagline}</p>
          )}

          {/* Season / Transport / Language pills */}
          {(guide?.season || guide?.transport?.length || guide?.languages?.length) && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {guide?.season && (
                <span className="text-xs font-semibold bg-white/15 backdrop-blur-sm text-white px-2.5 py-1 rounded-full">{guide.season}</span>
              )}
              {guide?.transport?.map((t: string) => (
                <span key={t} className="text-xs font-semibold bg-white/15 backdrop-blur-sm text-white px-2.5 py-1 rounded-full">{t}</span>
              ))}
              {guide?.languages?.map((l: string) => (
                <span key={l} className="text-xs font-semibold bg-white/15 backdrop-blur-sm text-white px-2.5 py-1 rounded-full">{l}</span>
              ))}
            </div>
          )}

          {/* Stats + group link + host button — streamed in */}
          <Suspense fallback={<div className="mt-5 h-14" />}>
            <HeroStats
              name={name}
              cityId={cityId}
              groupLink={guide?.groupLink}
              groupLabel={guide?.groupLabel}
              userId={session?.id}
              isYourNeighborhood={isYourNeighborhood}
            />
          </Suspense>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-14">

        {/* About — unique, indexable text per neighborhood, renders
            immediately (no DB). Real structured data only; see buildAboutCopy. */}
        <div>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">About {name}</h2>
          <p className="text-sm text-gray-700 leading-relaxed max-w-3xl">
            {aboutCopy}
          </p>
          {nearestForAbout.length > 0 && (
            <p className="text-sm text-gray-500 mt-2">
              Nearby: {nearestForAbout.map((n, i) => (
                <span key={n.slug}>
                  <Link href={`/neighborhoods/${n.slug}`} className="text-amber-600 font-medium hover:underline">{n.name}</Link>
                  {i < nearestForAbout.length - 1 ? ', ' : ''}
                </span>
              ))} · <Link href="/neighborhoods" className="text-amber-600 font-medium hover:underline">all neighborhoods</Link>
            </p>
          )}
        </div>

        {/* "Live here?" nudge — immediate, session-only */}
        {hasNoNeighborhood && (
          <div className="flex items-center justify-between gap-4 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="text-xl">🏡</span>
              <p className="text-sm text-blue-800 font-medium">
                Do you live in {name}? Set it as your neighborhood so locals can find you.
              </p>
            </div>
            <Link href="/profile"
              className="shrink-0 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors">
              Update profile
            </Link>
          </div>
        )}

        {/* Map — immediate, no DB */}
        <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
          <div className="relative h-36 sm:h-48 w-full bg-gray-100">
            <MapSection lat={meta.lat} lon={meta.lon} name={name} />
          </div>
          <div className="bg-white px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-gray-600 font-medium"><span aria-hidden="true">📍</span> {name}, {city.name}</span>
            <a href={`https://www.google.com/maps/search/${encodeURIComponent(`${name} ${city.name} ${countryName(city.country)}`)}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              Open in Maps →
            </a>
          </div>
        </div>

        {/* Wall + all content — streams in as DB resolves */}
        <Suspense fallback={<ContentSkeleton />}>
          <NeighborhoodSections
            name={name}
            slug={slug}
            meta={meta}
            siblings={siblings}
            cityId={cityId}
            city={city}
            guide={guide}
            myId={session?.id ?? null}
            isStaff={isStaff}
            hasNoNeighborhood={!!hasNoNeighborhood}
            sideLabel={sideLabel}
          />
        </Suspense>

        {/* Share */}
        <SocialShare
          title={`${meta.emoji} ${name} — Smileys Community ${city.name}`}
          url={`${APP_URL}/neighborhoods/${slug}`}
          cacheKey={slug.slice(0, 6)}
        />
      </div>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14 text-center">
          <h2 className="text-2xl font-extrabold text-white mb-3">Want to join these events?</h2>
          <p className="text-gray-400 mb-7 text-sm">Smileys is an application-based community. Apply once, attend everything.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/apply" className="px-6 py-3 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors shadow-sm">
              Apply to join
            </Link>
            <Link href="/neighborhoods" className="px-6 py-3 rounded-2xl border border-white/10 text-gray-300 font-semibold text-sm hover:bg-white/5 transition-colors">
              More neighborhoods
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
