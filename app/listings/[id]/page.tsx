import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { APP_URL, SITE_URL } from '@/lib/env'
import { redactListingForGuest } from '@/lib/listingsPublic'

export const dynamic = 'force-dynamic'

async function getListing(id: string) {
  return prisma.listing.findUnique({
    where: { id, status: 'active' },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) return {}

  const CAT_LABELS: Record<string, string> = {
    ROOMS: 'Room for rent', JOBS: 'Job listing', SERVICES: 'Service',
    BUY_SELL: 'For sale', FREE: 'Free item', RECO: 'Recommendation',
  }

  const catLabel = CAT_LABELS[listing.category] ?? 'Listing'
  const title = `${listing.title} — Smileys Community`
  const pricePart = listing.price ? ` · ${listing.price}` : ''
  const description = `${catLabel}${pricePart} — ${listing.description.slice(0, 130)}`
  const pageUrl = `${APP_URL}/listings/${id}`

  const photo = listing.photo ? resolveImageUrl(listing.photo) : null
  // ?w=1200 hits the file route's PREVIEW resize so the OG image
  // lands under WhatsApp / iMessage / X's ~600 KB cap. External
  // photos (already-http) ship as-is.
  const imageUrl = photo?.startsWith('http') ? photo : photo ? `${SITE_URL}${photo}?w=1200` : `${APP_URL}/api/og`

  return {
    title,
    description,
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

const CAT_META: Record<string, { label: string; badge: string; header: string }> = {
  ROOMS:    { label: 'Room',           badge: 'bg-blue-100 text-blue-700',    header: 'from-blue-400 to-blue-500'     },
  JOBS:     { label: 'Job',            badge: 'bg-green-100 text-green-700',  header: 'from-green-400 to-green-500'   },
  SERVICES: { label: 'Service',        badge: 'bg-orange-100 text-orange-700',header: 'from-orange-400 to-orange-500' },
  BUY_SELL: { label: 'Buy / Sell',     badge: 'bg-purple-100 text-purple-700',header: 'from-purple-400 to-purple-500' },
  FREE:     { label: 'Free',           badge: 'bg-teal-100 text-teal-700',    header: 'from-teal-400 to-teal-500'     },
  RECO:     { label: 'Recommendation', badge: 'bg-amber-100 text-amber-700',  header: 'from-amber-400 to-amber-500'   },
}

const CAT_EMOJI: Record<string, string> = {
  ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁', RECO: '⭐',
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

  // Guests get the teaser projection (no contact, photo, full
  // description, or poster identity). The page is intentionally
  // public for SEO; details unlock on sign-in.
  const listing = session ? raw : redactListingForGuest(raw)

  const cat    = CAT_META[listing.category]
  const emoji  = CAT_EMOJI[listing.category] ?? '📌'
  const photo  = resolveImageUrl(listing.photo)
  // #7 perf: 128-wide thumb for the author avatar; listing photo
  // stays full-size since it's the page's primary content.
  const avatar = avatarUrl(listing.user.profilePhoto, 128)

  const waHref = listing.contact
    ? (listing.contact.startsWith('http')
        ? listing.contact
        : `https://wa.me/${listing.contact.replace(/\D/g, '')}`)
    : null

  const isOwner = session?.id === raw.user.id

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">

      {/* Back nav */}
      <div className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/listings" className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="font-semibold text-gray-900 text-sm truncate flex-1">Community Board</span>
          {isOwner && (
            <Link href="/listings" className="text-xs text-amber-600 font-semibold hover:underline">
              Manage
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Photo or gradient header */}
          {photo ? (
            <div className="bg-gray-100">
              <img src={photo} alt={listing.title} className="w-full max-h-[60vh] object-contain" />
            </div>
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
              {session && (
                <Link href={`/members/${listing.user.id}`}
                  className="text-xs text-amber-600 font-semibold hover:underline shrink-0">
                  View profile →
                </Link>
              )}
            </div>

            {/* CTA */}
            {session ? (
              waHref ? (
                <a href={waHref} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-bold rounded-2xl transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.134.558 4.133 1.534 5.864L.057 23.57a.5.5 0 00.612.612l5.706-1.477A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.794 9.794 0 01-5.002-1.374l-.358-.213-3.724.964.991-3.621-.234-.373A9.79 9.79 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
                  </svg>
                  Contact on WhatsApp
                </a>
              ) : (
                <p className="text-sm text-gray-400 text-center py-2">No contact info provided.</p>
              )
            ) : (
              <div className="text-center space-y-3 py-4 bg-amber-50 rounded-2xl px-4">
                <p className="text-sm font-semibold text-gray-700">Members only</p>
                <p className="text-xs text-gray-600">Sign in to contact this member and see full details.</p>
                <Link href="/login"
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
