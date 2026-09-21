import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveImageUrl, avatarUrl, firstNameOf } from '@/lib/data'
import { contactRender, describeAttrs } from '@/lib/listingDisplay'
import { ListingGallery, ListingActions } from '@/components/ListingPermalink'
import { APP_URL, SITE_URL } from '@/lib/env'
import { redactListingForGuest, TEASER_DESCRIPTION_LIMIT } from '@/lib/listingsPublic'
import { authorProjector } from '@/lib/authorProjection'
import { LIVE_BOARD_AUTHOR, redactBoardTextForGuest } from '@/lib/boardAccess'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'

export const dynamic = 'force-dynamic'

async function getListing(id: string) {
  return prisma.listing.findUnique({
    // Whose listing it is matters here too: a banned, suspended or hidden
    // seller's permalink kept serving their phone number to anyone holding
    // the link, long after the marketplace stopped showing the card. The
    // JSON endpoints apply the same rule (lib/boardAccess).
    where: { id, user: LIVE_BOARD_AUTHOR },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } } },
  })
}

/**
 * What a reader can do with this row.
 *
 * The query used to require status 'active', so a listing that sold or ran
 * out turned every link to it — a WhatsApp share, a bookmark, the link in the
 * seller's own message thread — into a 404, which reads as "this never
 * existed" rather than "this is over". Only a deleted row (and an unknown id)
 * is a real 404 now.
 *
 * 'active' with expiresAt in the past counts as expired: the sweep that flips
 * the column runs on a schedule, and the page must not claim a dead listing
 * is live in the gap.
 */
function availabilityOf(l: { status: string; expiresAt: Date }): 'active' | 'filled' | 'expired' | 'gone' {
  if (l.status === 'deleted') return 'gone'
  if (l.status === 'filled')  return 'filled'
  if (l.status === 'expired' || l.expiresAt.getTime() < Date.now()) return 'expired'
  return l.status === 'active' ? 'active' : 'gone'
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) return {}
  // A removed listing 404s below; its title, price, photo and eighty raw
  // characters must not be resolved into a <head> on the way there.
  const availability = availabilityOf(listing)
  if (availability === 'gone') return {}
  // A sold or expired listing still renders (see availabilityOf), but it has
  // nothing to offer a search engine — index the live ones only.
  const live = availability === 'active'

  const CAT_LABELS: Record<string, string> = {
    ROOMS: 'Room for rent', JOBS: 'Job listing', SERVICES: 'Service',
    BUY_SELL: 'For sale', FREE: 'Free item', RECO: 'Recommendation',
  }

  const catLabel = CAT_LABELS[listing.category] ?? 'Listing'
  const title = `${listing.title} — Smileys Community`
  const pricePart = listing.price ? ` · ${listing.price}` : ''
  // The guest teaser, exactly: a link preview is read logged out, by every
  // crawler and every chat app that unfurls the link. It quoted 130 raw
  // characters where the page shows a guest 80 — and the raw text is where
  // "WhatsApp 0555 …" tends to be, so the number the body below redacts to
  // "[number for members]" was in og:description all along.
  const description = `${catLabel}${pricePart} — ${redactBoardTextForGuest(listing.description).slice(0, TEASER_DESCRIPTION_LIMIT)}`
  const pageUrl = `${APP_URL}/board/${id}`

  const photo = listing.photo ? resolveImageUrl(listing.photo) : null
  // ?w=1200 hits the file route's PREVIEW resize so the OG image
  // lands under WhatsApp / iMessage / X's ~600 KB cap. External
  // photos (already-http) ship as-is.
  const imageUrl = photo?.startsWith('http') ? photo : photo ? `${SITE_URL}${photo}?w=1200` : `${APP_URL}/api/og`

  return {
    title,
    description,
    robots: live ? undefined : { index: false, follow: true },
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Smileys Community',
      images: [{ url: imageUrl, width: 1200, height: 630, alt: listing.title }],
      type: 'website',
    },
    twitter: {
      card: listing.photo ? 'summary_large_image' : 'summary',
      title,
      description,
      images: [imageUrl],
    },
  }
}

// Same set as the marketplace sheet's (components/BoardHub) — this copy was
// missing Wanted, Pets and Lost & Found, so those listings arrived on their
// own page with no category badge at all.
const CAT_META: Record<string, { label: string; badge: string; header: string }> = {
  ROOMS:    { label: 'Room',           badge: 'bg-blue-100 text-blue-700',    header: 'from-blue-400 to-blue-500'     },
  JOBS:     { label: 'Job',            badge: 'bg-green-100 text-green-700',  header: 'from-green-400 to-green-500'   },
  SERVICES: { label: 'Service',        badge: 'bg-orange-100 text-orange-700',header: 'from-orange-400 to-orange-500' },
  BUY_SELL: { label: 'Buy / Sell',     badge: 'bg-purple-100 text-purple-700',header: 'from-purple-400 to-purple-500' },
  FREE:     { label: 'Free',           badge: 'bg-teal-100 text-teal-700',    header: 'from-teal-400 to-teal-500'     },
  WANTED:   { label: 'Wanted',         badge: 'bg-cyan-100 text-cyan-700',    header: 'from-cyan-400 to-cyan-500'     },
  PETS:     { label: 'Adopt a Pet',    badge: 'bg-pink-100 text-pink-700',    header: 'from-pink-400 to-pink-500'     },
  RECO:     { label: 'Recommendation', badge: 'bg-amber-100 text-amber-700',  header: 'from-amber-400 to-amber-500'   },
  LOST_FOUND:  { label: 'Lost & Found', badge: 'bg-yellow-100 text-yellow-700', header: 'from-yellow-400 to-yellow-500' },
  EXPERIENCES: { label: 'Experience',   badge: 'bg-indigo-100 text-indigo-700', header: 'from-indigo-400 to-indigo-500' },
}

const CAT_EMOJI: Record<string, string> = {
  ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁', RECO: '⭐',
  WANTED: '🔎', PETS: '🐾', LOST_FOUND: '🔍', EXPERIENCES: '🎟️',
}

function timeAgo(date: Date) {
  const diff = Date.now() - date.getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return d === 1 ? '1 day ago' : `${d} days ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [raw, session] = await Promise.all([getListing(id), getSession()])

  if (!raw) notFound()
  // …and a blocked pair sees nothing of each other, here as everywhere.
  if (session && raw.user && await isBlockedEitherWay(session.id, raw.user.id)) notFound()

  const availability = availabilityOf(raw)
  if (availability === 'gone') notFound()

  // Sold / expired: a plain, honest end-of-the-road page rather than a 404.
  // Somebody followed a real link to a real listing; tell them what happened
  // and point them at the marketplace.
  if (availability !== 'active') {
    return (
      <div className="min-h-screen bg-warm flex items-center justify-center px-4 py-24">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div aria-hidden="true" className="text-5xl mb-4">{availability === 'filled' ? '🤝' : '⏳'}</div>
          <h1 className="text-xl font-extrabold text-gray-900">This listing is no longer available</h1>
          <p className="text-sm text-gray-500 mt-2">
            {availability === 'filled'
              ? 'The member who posted it marked it as done.'
              : 'It expired — listings run for 30 days unless the member renews them.'}
          </p>
          {/* The owner arrives here from the expiry notification, which links
              the listing rather than the renew page — so this is where the
              renew action has to be, or the notice is a dead end. */}
          {availability === 'expired' && session?.id === raw.user.id && (
            <Link href={`/board/renew/${id}`}
              className="inline-block mt-6 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Renew for 30 days →
            </Link>
          )}
          <Link href="/marketplace"
            className={`inline-block mt-6 px-6 py-3 text-sm font-bold rounded-xl transition-colors ${
              availability === 'expired' && session?.id === raw.user.id
                ? 'ml-3 bg-gray-100 hover:bg-gray-200 text-gray-700'
                : 'bg-amber-500 hover:bg-amber-600 text-white'}`}>
            Browse the marketplace →
          </Link>
        </div>
      </div>
    )
  }

  // Saved state for the heart in the action row — one indexed lookup, and
  // only for a signed-in reader.
  const savedByMe = session
    ? !!(await prisma.savedListing.findUnique({
        where: { userId_listingId: { userId: session.id, listingId: raw.id } },
        select: { userId: true },
      }))
    : false

  // Guests get the teaser projection (no contact, photo, full
  // description, or poster identity). The page is intentionally
  // public for SEO; details unlock on sign-in.
  // A member sees the poster as the board shows authors: a connections-only
  // poster they aren't connected to is a first name with no photo or link.
  const shownPoster = session ? (await authorProjector(session, [raw.user]))(raw.user) : null
  const listing = session
    ? { ...raw, user: { ...raw.user, name: shownPoster!.name, profilePhoto: shownPoster!.profilePhoto } }
    : redactListingForGuest(raw)
  const posterLinkable = !!session && shownPoster!.id === raw.user.id

  const cat    = CAT_META[listing.category]
  const emoji  = CAT_EMOJI[listing.category] ?? '📌'
  // Cover first, then the gallery — the sheet has shown all five for a while;
  // here a shared link showed the cover and nothing else. Guests get an empty
  // photos array from redactListingForGuest, so this collapses to the cover.
  const gallery = [listing.photo, ...(listing.photos ?? [])].filter((u): u is string => !!u)
  // #7 perf: 128-wide thumb for the author avatar; listing photo
  // stays full-size since it's the page's primary content.
  const avatar = avatarUrl(listing.user.profilePhoto, 128)

  // A phone number or a WhatsApp link, never an arbitrary host labelled
  // "WhatsApp" — the same reading the sheet does. See lib/listingDisplay.
  const contact  = contactRender(listing.contact)
  const mailHref = listing.contactEmail
    ? `mailto:${listing.contactEmail}?subject=${encodeURIComponent(`Smileys: ${listing.title.slice(0, 60)}`)}`
    : null
  const attrRows = describeAttrs(listing.attrs as Record<string, unknown> | null)

  const isOwner = session?.id === raw.user.id

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">

      {/* Back nav */}
      <div className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/marketplace" className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="font-semibold text-gray-900 text-sm truncate flex-1">Marketplace</span>
          {isOwner && (
            <Link href="/marketplace?tab=MINE" className="text-xs text-amber-600 font-semibold hover:underline">
              Manage
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Photo gallery or gradient header */}
          {gallery.length > 0 ? (
            <ListingGallery photos={gallery} alt={listing.title} position={listing.photoPosition ?? 50} />
          ) : (
            <div className={`relative h-40 bg-gradient-to-br ${cat?.header ?? 'from-amber-400 to-amber-500'} flex items-center justify-center`}>
              <span className="text-7xl opacity-70 select-none">{emoji}</span>
            </div>
          )}

          <div className="p-6 space-y-5">

            {/* Category + price */}
            <div className="flex items-center gap-2 flex-wrap">
              {cat && (
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cat.badge}`}>
                  {cat.label}
                </span>
              )}
              {listing.neighborhood && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                  📍 {listing.neighborhood}
                </span>
              )}
              {listing.price && (
                <span className="text-sm font-bold text-gray-900 bg-gray-100 px-2.5 py-1 rounded-full">
                  {listing.price}
                </span>
              )}
              <span className="text-xs text-gray-400 ml-auto">{timeAgo(listing.createdAt)}</span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-extrabold text-gray-900 leading-snug">{listing.title}</h1>

            {/* Full description */}
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{listing.description}</p>

            {/* The category fields the poster filled in — collected by the
                form, stored by the API, and until now rendered nowhere. */}
            {attrRows.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                {attrRows.map(a => (
                  <div key={a.label} className="contents">
                    <dt className="text-gray-400 font-semibold text-xs self-center">{a.label}</dt>
                    <dd className="text-gray-800 font-medium">{a.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {/* Poster */}
            <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
              {avatar ? (
                <img src={avatar} alt={listing.user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 text-sm"
                  style={{ backgroundColor: listing.user.color || '#f59e0b' }}>
                  {listing.user.name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{listing.user.name}</p>
                <p className="text-xs text-gray-400">Posted {timeAgo(listing.createdAt)}</p>
              </div>
              {posterLinkable && (
                <Link href={`/members/${listing.user.id}`}
                  className="text-xs text-amber-600 font-semibold hover:underline shrink-0">
                  View profile →
                </Link>
              )}
            </div>

            {/* CTA. The in-app message is the primary path — the sheet has
                had it since the contact endpoint shipped, while this page
                said "No contact info provided" whenever both optional fields
                were blank, i.e. told the reader there was no way to reach a
                member they could in fact message. */}
            {session ? (
              <div className="space-y-2">
                <ListingActions
                  listingId={raw.id}
                  category={listing.category}
                  sellerId={raw.user.id}
                  sellerFirstName={firstNameOf(listing.user.name)}
                  title={listing.title}
                  initiallySaved={savedByMe}
                  canContact={!isOwner}
                />
                  {contact?.kind === 'text' && (
                    <p className="text-center text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-2xl py-3 px-4 break-words">
                      Contact: <span className="font-semibold text-gray-900">{contact.text}</span>
                    </p>
                  )}
                  {contact?.kind === 'link' && (
                    <a href={contact.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-bold rounded-2xl transition-colors">
                      Open the contact link the seller left
                    </a>
                  )}
                  {contact?.kind === 'whatsapp' && (
                    <a href={contact.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-bold rounded-2xl transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.134.558 4.133 1.534 5.864L.057 23.57a.5.5 0 00.612.612l5.706-1.477A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.794 9.794 0 01-5.002-1.374l-.358-.213-3.724.964.991-3.621-.234-.373A9.79 9.79 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
                      </svg>
                      Contact on WhatsApp
                    </a>
                  )}
                  {mailHref && (
                    <a href={mailHref}
                      className="flex items-center justify-center gap-2 w-full py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-bold rounded-2xl transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Contact by Email
                    </a>
                  )}
              </div>
            ) : (
              <div className="text-center space-y-3 py-4 bg-amber-50 rounded-2xl px-4">
                <p className="text-sm font-semibold text-gray-700">Members only</p>
                <p className="text-xs text-gray-600">Sign in to contact this member and see full details.</p>
                {/* …and come straight back to this listing. A bare /login
                    dropped the reader on the dashboard, one page away from
                    the thing they'd followed a link to. */}
                <Link href={`/login?return=/board/${raw.id}`}
                  className="inline-block px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                  Sign in to Smileys →
                </Link>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
