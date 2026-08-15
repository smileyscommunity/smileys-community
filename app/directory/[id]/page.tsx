import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { formatShortDate } from '@/lib/data'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { APP_URL, SITE_URL } from '@/lib/env'
import { attributionDisplay } from '@/lib/directory'
import { isSafeHref } from '@/lib/safeUrl'
import {
  DAY_KEYS,
  DAY_FULL_LABELS,
  formatHoursSchema,
  getOpenStatus,
  isValidRange,
  type BusinessHours,
} from '@/lib/businessHours'
import { neighborhoodToSlug, getNeighborhoodMeta } from '@/lib/neighborhoods'
import { HeaderActions, ReviewCta, FooterActions } from './DetailClient'

// Per-business detail page — the dedicated route that unlocks SEO,
// JSON-LD LocalBusiness markup, shareable URLs, and per-listing OG
// cards. Force-dynamic because the page joins live aggregate data
// (avg rating, save count) that we don't want stale.
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

async function loadBusiness(id: string) {
  return prisma.business.findFirst({
    where: { id, isApproved: true, isActive: true },
    include: {
      submittedBy: { select: { name: true } },
    },
  })
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { id } = await params
  const b = await loadBusiness(id)
  if (!b) {
    return { title: 'Business not found — Smileys Community' }
  }
  // ?w=1200 keeps the OG image under WhatsApp/iMessage/X's ~600 KB cap.
  const cover = b.coverImage ? `${SITE_URL}${resolveImageUrl(b.coverImage)}?w=1200` : `${APP_URL}/api/og`
  const title = `${b.name}${b.neighborhood ? ` · ${b.neighborhood}` : ''} — Smileys Community`
  const desc  = b.description.length > 155 ? `${b.description.slice(0, 152)}…` : b.description
  const url   = `${APP_URL}/directory/${b.id}`
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: desc,
      url,
      siteName: 'Smileys Community',
      type: 'website',
      images: [{ url: cover, secureUrl: cover, width: 1200, height: 630, alt: b.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
      images: [cover],
    },
  }
}

export default async function BusinessDetailPage({ params }: RouteParams) {
  const { id } = await params
  const session = await getSession()

  const business = await loadBusiness(id)
  if (!business) notFound()

  // ── Smileys history at this venue (phase 2.2) ─────────────────────────
  // The reverse of the event page's "View in directory" link, same
  // case-insensitive name match, same-city only. This is the layer that
  // makes the directory more than another maps site: not "4.5 stars from
  // strangers" but "the community has actually been here, N times, and
  // is going again Thursday."
  const today = todayInTz(DEFAULT_TZ)
  const venueEvents = await prisma.event.findMany({
    where: {
      location: { equals: business.name.replace(/\s+/g, ' ').trim(), mode: 'insensitive' },
      cityId:   business.cityId,
      status:   { in: ['published', 'archived'] },
    },
    select:  { id: true, title: true, emoji: true, date: true, time: true, status: true },
    orderBy: { date: 'desc' },
    take:    200,
  })
  const upcomingHere = venueEvents
    .filter(e => e.status === 'published' && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)
  const pastHereCount = venueEvents.filter(e => e.date < today).length

  // Aggregates + per-caller state, all in parallel.
  const [reviewsRaw, saveCount, mySave, myReview, myClaim] = await Promise.all([
    prisma.businessReview.findMany({
      where: {
        businessId: business.id,
        // Hidden reviews are excluded from the public list AND the
        // average, but visible to the author themselves via OR.
        OR: session
          ? [{ isHidden: false }, { authorId: session.id }]
          : [{ isHidden: false }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, rating: true, comment: true,
        ownerReply: true, ownerReplyAt: true,
        isHidden: true, createdAt: true,
        author: { select: { id: true, name: true, color: true, profilePhoto: true } },
        ownerReplyBy: { select: { id: true, name: true } },
      },
    }),
    prisma.businessSave.count({ where: { businessId: business.id } }),
    session ? prisma.businessSave.findUnique({
      where:  { userId_businessId: { userId: session.id, businessId: business.id } },
      select: { id: true },
    }) : Promise.resolve(null),
    session ? prisma.businessReview.findFirst({
      where:  { businessId: business.id, authorId: session.id },
      select: { id: true },
    }) : Promise.resolve(null),
    session ? prisma.businessClaim.findUnique({
      where:  { businessId_claimantId: { businessId: business.id, claimantId: session.id } },
      select: { status: true },
    }) : Promise.resolve(null),
  ])

  // Average rating uses only non-hidden reviews so the public number
  // matches what visitors see in the list.
  const visibleReviews = reviewsRaw.filter(r => !r.isHidden)
  const avgRating = visibleReviews.length > 0
    ? visibleReviews.reduce((sum, r) => sum + r.rating, 0) / visibleReviews.length
    : null

  const isMine     = session != null && business.claimedById === session.id
  const isStaff    = session != null && (session.role === 'admin' || session.role === 'moderator')

  // JSON-LD LocalBusiness markup. Pick the most specific @type we can
  // — Restaurant gets the special treatment, everything else falls
  // back to LocalBusiness. Adding more category→type mappings is
  // additive.
  const schemaType = business.category === 'Restaurant'
    ? 'Restaurant'
    : business.category === 'Cafe'
      ? 'CafeOrCoffeeShop'
      : business.category === 'Bar'
        ? 'BarOrPub'
        : 'LocalBusiness'

  const meta = business.neighborhood ? getNeighborhoodMeta(business.neighborhood) : null
  // ?w=1200: see absoluteImageUrl comment above. Crawlers ingesting
  // JSON-LD pick up images at the same size as the OG variant.
  const ldImage = business.coverImage
    ? `${SITE_URL}${resolveImageUrl(business.coverImage)}?w=1200`
    : business.logo
      ? `${SITE_URL}${resolveImageUrl(business.logo)}?w=1200`
      : undefined

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type':    schemaType,
    name:        business.name,
    description: business.description,
    url:         `${APP_URL}/directory/${business.id}`,
    image:       ldImage,
    address: {
      '@type':           'PostalAddress',
      addressLocality:   business.neighborhood ?? 'Istanbul',
      addressRegion:     'Istanbul',
      addressCountry:    'TR',
      streetAddress:     business.address ?? undefined,
    },
  }
  // Coordinates: explicit values win, neighborhood centroid is the
  // public fallback (matches the map view's resolution strategy).
  const lat = business.latitude  ?? meta?.lat
  const lon = business.longitude ?? meta?.lon
  if (lat != null && lon != null) {
    ld.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lon }
  }
  if (business.phone && /^[+\d\s\-()]{4,40}$/.test(business.phone)) {
    ld.telephone = business.phone
  }
  const sameAs: string[] = []
  if (business.website && isSafeHref(business.website)) sameAs.push(business.website)
  if (business.instagram && /^[A-Za-z0-9._]{1,30}$/.test(business.instagram.replace(/^@/, ''))) {
    sameAs.push(`https://instagram.com/${business.instagram.replace(/^@/, '')}`)
  }
  if (sameAs.length > 0) ld.sameAs = sameAs

  const hours = business.hours as BusinessHours | null
  const hoursSpec = formatHoursSchema(hours)
  if (hoursSpec.length > 0) ld.openingHoursSpecification = hoursSpec

  if (visibleReviews.length > 0 && avgRating != null) {
    ld.aggregateRating = {
      '@type':      'AggregateRating',
      ratingValue:  avgRating.toFixed(1),
      reviewCount:  visibleReviews.length,
      bestRating:   5,
      worstRating:  1,
    }
  }

  const openStatus = getOpenStatus(hours)
  const cover      = resolveImageUrl(business.coverImage)
  const logo       = resolveImageUrl(business.logo)
  const addedBy    = attributionDisplay(business.submittedBy?.name)

  // Shared summary for the client action components (header / reviews
  // header / footer — see DetailClient.tsx for the split rationale).
  const businessSummary = {
    id:              business.id,
    name:            business.name,
    hasClaimedOwner: business.claimedById != null,
    isMine,
    isStaff,
  }

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* JSON-LD — placed once at the top so Google's structured data
          parser finds it even if the user bounces before scrolling. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        // Escape so member-submitted business fields (name/description/address)
        // can't break out of the <script> block — a "</script><script>…"
        // payload would otherwise be stored XSS. Same escaping as the events page.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(ld).replace(/</g, '\\u003c'),
        }}
      />

      {/* Hero cover */}
      <div className="relative w-full h-64 sm:h-80 bg-gray-100">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={business.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-7xl text-gray-300">🏢</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        {/* Breadcrumb */}
        <div className="absolute top-3 left-3 sm:top-5 sm:left-5">
          <Link href="/directory"
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-white/95 backdrop-blur text-xs font-semibold text-gray-700 rounded-full hover:bg-white transition-colors shadow-sm">
            ← Directory
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 -mt-12 relative">
        {/* Header card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
          <div className="flex items-start gap-4">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={business.name}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border-2 border-white shadow-sm shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 leading-tight truncate">{business.name}</h1>
                {business.claimedById && (
                  <span title="Verified owner" className="text-emerald-500 text-xl shrink-0">✓</span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {business.category}
                {business.neighborhood && (
                  <>
                    {' · '}
                    <Link href={`/neighborhoods/${neighborhoodToSlug(business.neighborhood)}`} className="hover:underline">
                      {business.neighborhood}
                    </Link>
                  </>
                )}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {avgRating != null && (
                  <p className="text-sm">
                    <span className="text-amber-500">★</span>{' '}
                    <span className="font-bold text-gray-900">{avgRating.toFixed(1)}</span>{' '}
                    <span className="text-gray-400">· {visibleReviews.length} review{visibleReviews.length === 1 ? '' : 's'}</span>
                  </p>
                )}
                {saveCount > 0 && (
                  <p className="text-xs text-gray-400">★ saved by {saveCount} {saveCount === 1 ? 'member' : 'members'}</p>
                )}
              </div>
            </div>
          </div>

          {/* Badges row */}
          <div className="flex gap-2 mt-4 flex-wrap">
            {business.isExpatOwned    && <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">👤 Expat-owned</span>}
            {business.isExpatFriendly && <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2.5 py-1 rounded-full">🌍 Expat-friendly</span>}
            {business.memberDiscount  && <span className="bg-fuchsia-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">💸 {business.memberDiscount}</span>}
            {openStatus && (
              openStatus.open
                ? <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">🟢 Open · until {openStatus.closesAt}</span>
                : <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2.5 py-1 rounded-full">Closed{openStatus.opensAt ? ` · opens ${openStatus.opensAt}` : ''}</span>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-gray-700 mt-5 leading-relaxed whitespace-pre-wrap">{business.description}</p>

          {/* Tags — chips right under the description so the community
              signal ("We meet here") reads as part of the identity block,
              not buried in the info grid. "We meet here" opens the grid's
              dedicated filter pill view; other tags become a search. */}
          {business.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {business.tags.map(t => (
                <Link
                  key={t}
                  href={t === 'We meet here' ? '/directory?meet=1' : `/directory?q=${encodeURIComponent(t)}`}
                  className={t === 'We meet here'
                    ? 'text-xs font-bold bg-amber-500 text-white px-3 py-1 rounded-full hover:bg-amber-600 transition-colors'
                    : 'text-xs font-semibold bg-gray-100 text-gray-600 px-3 py-1 rounded-full hover:bg-amber-100 hover:text-amber-700 transition-colors'}
                >
                  {t === 'We meet here' ? '🤝 We meet here' : t}
                </Link>
              ))}
            </div>
          )}

          {/* Header actions — save / share / owner-edit. Review CTA
              lives with the Reviews section; claim + report live in
              the page footer. */}
          <HeaderActions
            business={businessSummary}
            initialIsSaved={mySave != null}
            currentUserId={session?.id ?? null}
            ownerEditPayload={{
              id:              business.id,
              name:            business.name,
              category:        business.category,
              description:     business.description,
              neighborhood:    business.neighborhood,
              address:         business.address,
              phone:           business.phone,
              website:         business.website,
              instagram:       business.instagram,
              languages:       business.languages,
              hours:           hours,
              memberDiscount:  business.memberDiscount,
              tags:            business.tags,
            }}
          />
        </div>

        {/* Visit card — practical info as one contact-sheet card of
            tappable rows instead of a patchwork of mini-cards. Rows
            with a destination are fully tappable; the trailing hint
            says where the tap goes. */}
        {(business.address || business.phone || business.website || business.instagram || business.languages) && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mt-4 overflow-hidden divide-y divide-gray-50">
            {business.address && (() => {
              const inner = (
                <>
                  <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">📍</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">Address</span>
                    <span className="block text-sm text-gray-800">{business.address}</span>
                  </span>
                </>
              )
              return lat != null && lon != null ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
                  target="_blank" rel="noopener noreferrer nofollow"
                  className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-amber-50/60 transition-colors"
                >
                  {inner}
                  <span className="text-xs font-semibold text-amber-700 shrink-0">Maps ↗</span>
                </a>
              ) : (
                <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">{inner}</div>
              )
            })()}
            {business.phone && /^[+\d\s\-()]{4,40}$/.test(business.phone) && (
              <a
                href={`tel:${business.phone.replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-amber-50/60 transition-colors"
              >
                <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">📞</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">Phone</span>
                  <span className="block text-sm text-gray-800">{business.phone}</span>
                </span>
                <span className="text-xs font-semibold text-amber-700 shrink-0">Call</span>
              </a>
            )}
            {business.website && isSafeHref(business.website) && (
              <a
                href={business.website}
                target="_blank" rel="noopener noreferrer nofollow"
                className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-amber-50/60 transition-colors"
              >
                <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">🌐</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">Website</span>
                  <span className="block text-sm text-gray-800 truncate">{business.website.replace(/^https?:\/\//, '')}</span>
                </span>
                <span className="text-xs font-semibold text-amber-700 shrink-0">Visit ↗</span>
              </a>
            )}
            {business.instagram && /^[A-Za-z0-9._]{1,30}$/.test(business.instagram.replace(/^@/, '')) && (
              <a
                href={`https://instagram.com/${business.instagram.replace(/^@/, '')}`}
                target="_blank" rel="noopener noreferrer nofollow"
                className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-amber-50/60 transition-colors"
              >
                <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">📸</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">Instagram</span>
                  <span className="block text-sm text-gray-800 truncate">@{business.instagram.replace(/^@/, '')}</span>
                </span>
                <span className="text-xs font-semibold text-amber-700 shrink-0">Open ↗</span>
              </a>
            )}
            {business.languages && (
              <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">🗣</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">Languages</span>
                  <span className="block text-sm text-gray-800">{business.languages}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Hours card */}
        {hours && DAY_KEYS.some(d => hours[d] && isValidRange(hours[d] ?? '')) && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 mt-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">🕐</span>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Hours</p>
              {openStatus && (
                openStatus.open
                  ? <span className="ml-auto bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2 py-0.5 rounded-full">Open · until {openStatus.closesAt}</span>
                  : <span className="ml-auto bg-gray-100 text-gray-600 text-[11px] font-bold px-2 py-0.5 rounded-full">Closed{openStatus.opensAt ? ` · opens ${openStatus.opensAt}` : ''}</span>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {DAY_KEYS.map(d => {
                const v = hours[d]
                return (
                  <div key={d} className="flex justify-between border-b border-gray-50 last:border-0 py-1">
                    <dt className="text-gray-600">{DAY_FULL_LABELS[d]}</dt>
                    <dd className={`font-medium ${v && isValidRange(v) ? 'text-gray-900' : 'text-gray-300 italic'}`}>
                      {v && isValidRange(v) ? v.replace('-', ' – ') : 'Closed'}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        )}

        {/* Smileys history — the "why members like this place" proof.
            Renders only when the community has actually been here; a venue
            with no history simply doesn't get the section, rather than an
            empty box implying a dead relationship. */}
        {(upcomingHere.length > 0 || pastHereCount > 0) && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 mt-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Smileys has been here</h2>
            <p className="text-sm text-gray-600 mb-4">
              {pastHereCount > 0
                ? `${pastHereCount} Smileys event${pastHereCount === 1 ? '' : 's'} held at ${business.name}.`
                : `The community is heading to ${business.name}.`}
            </p>
            {upcomingHere.length > 0 && (
              <div className="space-y-2">
                {upcomingHere.map(e => (
                  <Link key={e.id} href={`/events/${e.id}`}
                    className="flex items-center justify-between gap-3 border border-gray-100 hover:border-amber-200 hover:bg-amber-50/40 rounded-xl px-4 py-3 transition-colors">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span aria-hidden="true" className="text-xl">{e.emoji}</span>
                      <span className="font-semibold text-gray-900 truncate">{e.title}</span>
                    </span>
                    <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">
                      {formatShortDate(e.date)} · {e.time}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Reviews — server-rendered list for SEO. The ReviewCta in the
            section header opens the interactive drawer for writing and
            editing. */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 mt-6" id="reviews">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-900">
              Reviews{visibleReviews.length > 0 ? ` · ${visibleReviews.length}` : ''}
            </h2>
            <div className="flex items-center gap-3">
              {avgRating != null && (
                <p className="text-sm">
                  <span className="text-amber-500">★</span>{' '}
                  <span className="font-bold">{avgRating.toFixed(1)}</span>
                </p>
              )}
              <ReviewCta
                business={businessSummary}
                initialMyReviewId={myReview?.id ?? null}
                currentUserId={session?.id ?? null}
              />
            </div>
          </div>

          {reviewsRaw.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-2xl tracking-[0.3em] text-gray-200" aria-hidden="true">★★★★★</p>
              <p className="text-sm font-semibold text-gray-900 mt-2">No reviews yet</p>
              <p className="text-xs text-gray-500 mt-1">Been here with Smileys? Be the first to review.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviewsRaw.map(r => {
                const avatar = r.author.profilePhoto ? avatarUrl(r.author.profilePhoto, 64) : null
                return (
                  <article key={r.id} className={`pt-4 border-t border-gray-100 first:border-0 first:pt-0 ${r.isHidden ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-3">
                      {avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatar} alt={r.author.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: r.author.color }}>
                          {r.author.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900 truncate">{r.author.name}</p>
                          <span className="text-amber-500 text-sm tracking-tight" aria-label={`${r.rating} stars`}>
                            {'★'.repeat(r.rating)}<span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span>
                          </span>
                          {r.isHidden && (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-100 rounded-full px-2 py-0.5">Hidden by admin</span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    {r.comment && (
                      <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap leading-relaxed">{r.comment}</p>
                    )}
                    {r.ownerReply && (
                      <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-3 mt-3 ml-12">
                        <p className="text-[11px] font-bold text-emerald-800 mb-1">✓ Owner's response</p>
                        <p className="text-xs text-emerald-900 whitespace-pre-wrap leading-relaxed">{r.ownerReply}</p>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* Footer — housekeeping actions + attribution */}
        <FooterActions
          business={businessSummary}
          currentUserId={session?.id ?? null}
          initialMyClaimStatus={myClaim?.status ?? null}
        />
        <p className="text-xs text-gray-400 text-center mt-4 mb-2">
          Added by <span className="text-gray-600">{addedBy}</span>
        </p>
      </div>
    </div>
  )
}
