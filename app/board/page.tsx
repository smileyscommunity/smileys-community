'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/contexts/AuthContext'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { resolveImageUrl, avatarUrl, ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { toast } from 'sonner'
import { SkeletonCard } from '@/components/Skeleton'
import SocialShare from '@/components/SocialShare'
import { APP_URL } from '@/lib/env'

const CATEGORIES: Array<{ id: string; label: string; emoji: string; activeCls: string; memberOnly?: boolean }> = [
  { id: 'ALL',      label: 'All',             emoji: '🗂️', activeCls: 'bg-amber-500 text-white border-amber-500'         },
  { id: 'MINE',     label: 'Mine',            emoji: '👤', activeCls: 'bg-amber-500 text-white border-amber-500', memberOnly: true },
  { id: 'SAVED',    label: 'Saved',           emoji: '❤️', activeCls: 'bg-red-500 text-white border-red-500',     memberOnly: true },
  { id: 'ROOMS',    label: 'Rooms',           emoji: '🏠', activeCls: 'bg-blue-500 text-white border-blue-500'           },
  { id: 'JOBS',     label: 'Jobs',            emoji: '💼', activeCls: 'bg-green-500 text-white border-green-500'         },
  { id: 'SERVICES', label: 'Services',        emoji: '🛠️', activeCls: 'bg-orange-500 text-white border-orange-500'       },
  { id: 'BUY_SELL', label: 'Buy & Sell',      emoji: '🛍️', activeCls: 'bg-purple-500 text-white border-purple-500'       },
  { id: 'FREE',       label: 'Free stuff',      emoji: '🎁', activeCls: 'bg-teal-500 text-white border-teal-500'           },
  { id: 'LOST_FOUND', label: 'Lost & Found',  emoji: '🔍', activeCls: 'bg-yellow-500 text-white border-yellow-500'       },
  { id: 'RECO',       label: 'Recommendations',emoji: '⭐', activeCls: 'bg-amber-500 text-white border-amber-500'         },
  { id: 'EXPERIENCES', label: 'Experiences',  emoji: '🎟️', activeCls: 'bg-indigo-500 text-white border-indigo-500'       },
  { id: 'PETS',     label: 'Adopt a Pet',     emoji: '🐾', activeCls: 'bg-pink-500 text-white border-pink-500'           },
]

const ALERT_CATS = [
  { id: 'ROOMS',    label: 'Rooms',           emoji: '🏠' },
  { id: 'JOBS',     label: 'Jobs',            emoji: '💼' },
  { id: 'SERVICES', label: 'Services',        emoji: '🛠️' },
  { id: 'BUY_SELL', label: 'Buy & Sell',      emoji: '🛍️' },
  { id: 'FREE',     label: 'Free stuff',      emoji: '🎁' },
  { id: 'RECO',     label: 'Recommendations', emoji: '⭐' },
  { id: 'LOST_FOUND',   label: 'Lost & Found', emoji: '🔍' },
  { id: 'EXPERIENCES',  label: 'Experiences',  emoji: '🎟️' },
  { id: 'PETS',         label: 'Adopt a Pet',  emoji: '🐾' },
]

const CAT_META: Record<string, { label: string; badge: string; header: string }> = {
  ROOMS:    { label: 'Room',           badge: 'bg-blue-100 text-blue-700',    header: 'from-blue-400 to-blue-500'     },
  JOBS:     { label: 'Job',            badge: 'bg-green-100 text-green-700',  header: 'from-green-400 to-green-500'   },
  SERVICES: { label: 'Service',        badge: 'bg-orange-100 text-orange-700',header: 'from-orange-400 to-orange-500' },
  BUY_SELL: { label: 'Buy / Sell',     badge: 'bg-purple-100 text-purple-700',header: 'from-purple-400 to-purple-500' },
  FREE:     { label: 'Free',           badge: 'bg-teal-100 text-teal-700',    header: 'from-teal-400 to-teal-500'     },
  RECO:     { label: 'Recommendation', badge: 'bg-amber-100 text-amber-700',  header: 'from-amber-400 to-amber-500'   },
  LOST_FOUND:  { label: 'Lost & Found', badge: 'bg-yellow-100 text-yellow-700', header: 'from-yellow-400 to-yellow-500'   },
  PETS:        { label: 'Adopt a Pet',  badge: 'bg-pink-100 text-pink-700',    header: 'from-pink-400 to-pink-500'       },
  EXPERIENCES: { label: 'Experience',  badge: 'bg-indigo-100 text-indigo-700', header: 'from-indigo-400 to-indigo-500'   },
}

const CAT_EMOJI: Record<string, string> = {
  ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁', LOST_FOUND: '🔍', RECO: '⭐', PETS: '🐾', EXPERIENCES: '🎟️',
}

// Heart icon + red on /board is deliberate. /directory uses an
// amber bookmark icon for "save for later"; /board uses the
// universal heart-for-favorite pattern (Instagram, Twitter et al)
// because the listings flow leans more like a marketplace feed than
// a curated bookmark. Don't unify the two — the icon family is the
// signal, the color follows the icon.
interface Listing {
  id: string
  category: string
  title: string
  description: string
  price: string | null
  photo: string | null
  photoPosition: number
  contact: string | null
  neighborhood: string | null
  status: string
  expiresAt: string
  createdAt: string
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return d === 1 ? '1 day ago' : `${d} days ago`
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function shareUrl(id: string) {
  return `${window.location.origin}/app/board/${id}`
}

async function copyShare(id: string): Promise<boolean> {
  const url = shareUrl(id)
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    // navigator.clipboard can be unavailable (older/embedded webviews); a
    // native prompt() is suppressed in the installed PWA, so surface the link
    // in a toast the user can long-press to copy instead.
    toast(url, { description: 'Long-press to copy this link' })
    return false
  }
}

function ListingModal({ listing, currentUserId, isLoggedIn, isSaved, onToggleSave, onClose, onDelete, onMarkFilled, onRenew }: {
  listing: Listing
  // null = not signed in. Previous shape used '' and 'guest' as
  // sentinels; consumers now pass `isLoggedIn ? user.id : null`.
  currentUserId: string | null
  isLoggedIn: boolean
  isSaved: boolean
  onToggleSave: (id: string) => void
  onClose: () => void
  onDelete: (id: string) => void
  onMarkFilled: (id: string) => void
  onRenew: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  // Two-state inline confirm for Delete — first click reveals
  // "Sure? Yes / Cancel", second click fires onDelete. Replaces a
  // native window.confirm which broke the styled-modal rhythm.
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const isOwner  = listing.user.id === currentUserId
  const isGuest  = !currentUserId
  const photo    = resolveImageUrl(listing.photo)
  // #7 perf: 64-wide thumb for the small author avatar (w-9 css = 36px).
  // photo (listing image) stays full-size — it's the actual content.
  const avatar   = avatarUrl(listing.user.profilePhoto, 64)
  const cat      = CAT_META[listing.category]
  const emoji    = CAT_EMOJI[listing.category] ?? '📌'
  const daysLeft = Math.ceil((new Date(listing.expiresAt).getTime() - Date.now()) / 86400000)

  async function handleShare() {
    const ok = await copyShare(listing.id)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    else toast.success('Link copied!')
  }

  async function handleSubmitReport() {
    if (!reportReason) { toast.error('Pick a reason'); return }
    setReportSubmitting(true)
    try {
      const res = await fetch(`/app/api/listings/${listing.id}/report`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: reportReason, details: reportDetails || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not submit report'); return }
      toast.success('Reported — thanks. Moderators will review.')
      setReportOpen(false)
      setReportReason('')
      setReportDetails('')
    } catch {
      toast.error('Network error')
    } finally {
      setReportSubmitting(false)
    }
  }

  const waHref = listing.contact
    ? (listing.contact.startsWith('http')
        ? listing.contact
        : `https://wa.me/${listing.contact.replace(/\D/g, '')}`)
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-modal-title"
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >

        {/* Photo or gradient header */}
        {photo ? (
          <div className="relative h-[220px] shrink-0 bg-gray-100">
            <Image src={photo} alt={listing.title} fill sizes="(min-width: 640px) 512px, 100vw"
              style={{ objectPosition: `center ${listing.photoPosition ?? 50}%` }}
              className="object-cover" />
            <div className="absolute top-3 right-3 flex items-center gap-2">
              {isLoggedIn && (
              <button onClick={() => onToggleSave(listing.id)} aria-label={isSaved ? 'Unsave listing' : 'Save listing'} className={`w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${isSaved ? 'bg-red-500 text-white' : 'bg-black/30 text-white hover:bg-black/50'}`} title={isSaved ? 'Unsave' : 'Save'}>
                <svg aria-hidden="true" className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
              )}
              <button onClick={handleShare} aria-label="Copy link to listing" className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-colors" title="Copy link">
                {copied ? <span aria-hidden="true">✓</span> : (
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-colors"><span aria-hidden="true">✕</span></button>
            </div>
          </div>
        ) : (
          <div className={`relative h-28 shrink-0 bg-gradient-to-br ${cat?.header ?? 'from-amber-400 to-amber-500'} flex items-center justify-center`}>
            <span aria-hidden="true" className="text-6xl opacity-70 select-none">{emoji}</span>
            <div className="absolute top-3 right-3 flex items-center gap-2">
              {isLoggedIn && (
              <button onClick={() => onToggleSave(listing.id)} aria-label={isSaved ? 'Unsave listing' : 'Save listing'} className={`w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${isSaved ? 'bg-red-500 text-white' : 'bg-black/20 text-white hover:bg-black/40'}`} title={isSaved ? 'Unsave' : 'Save'}>
                <svg aria-hidden="true" className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
              )}
              <button onClick={handleShare} aria-label="Copy link to listing" className="w-8 h-8 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/40 transition-colors" title="Copy link">
                {copied ? <span aria-hidden="true">✓</span> : (
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/40 transition-colors"><span aria-hidden="true">✕</span></button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {cat && <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cat.badge}`}>{cat.label}</span>}
            {listing.neighborhood && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700"><span aria-hidden="true">📍 </span>{listing.neighborhood}</span>
            )}
            {listing.price && <span className="text-sm font-bold text-gray-900 bg-gray-100 px-2.5 py-1 rounded-full">{listing.price}</span>}
            <span className="text-xs text-gray-400 ml-auto">{timeAgo(listing.createdAt)}</span>
          </div>
          <h2 id="listing-modal-title" className="text-lg font-extrabold text-gray-900 leading-snug">{listing.title}</h2>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{listing.description}</p>
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            {avatar
              ? <Image src={avatar} alt={listing.user.name} width={36} height={36} className="w-9 h-9 rounded-full object-cover shrink-0" />
              : <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: listing.user.color || '#f59e0b' }}>{listing.user.name[0]}</div>
            }
            <div>
              <p className="text-sm font-semibold text-gray-900">{listing.user.name}</p>
              <p className="text-xs text-gray-400">Posted {timeAgo(listing.createdAt)}</p>
            </div>
            {isOwner && <span className="ml-auto text-xs text-gray-400">Your listing</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-gray-100 space-y-2 shrink-0">
          {isGuest && (
            <Link href={`/login?return=/board/${listing.id}`}
              className="block text-center w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-2xl transition-colors">
              Sign in to see contact & full details →
            </Link>
          )}
          {waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-bold rounded-2xl transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.134.558 4.133 1.534 5.864L.057 23.57a.5.5 0 00.612.612l5.706-1.477A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.794 9.794 0 01-5.002-1.374l-.358-.213-3.724.964.991-3.621-.234-.373A9.79 9.79 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
              </svg>
              Contact on WhatsApp
            </a>
          )}
          {isOwner && (
            <div className="flex gap-2">
              {daysLeft <= 7
                ? <button onClick={() => { onRenew(listing.id); onClose() }} className="flex-1 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl transition-colors">Renew listing</button>
                : <button onClick={() => { onMarkFilled(listing.id); onClose() }} className="flex-1 text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl transition-colors">Mark as done</button>
              }
              {deleteConfirm ? (
                <>
                  <button onClick={() => { onDelete(listing.id); onClose() }}
                    className="text-sm font-semibold bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl transition-colors">
                    Yes, delete
                  </button>
                  <button onClick={() => setDeleteConfirm(false)}
                    className="text-sm font-semibold text-gray-600 hover:bg-gray-100 px-3 py-2.5 rounded-xl transition-colors">
                    Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setDeleteConfirm(true)}
                  className="text-sm font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 px-4 py-2.5 rounded-xl transition-colors">
                  Delete
                </button>
              )}
            </div>
          )}
          {/* Flag — hidden for the owner (can't report self) and for guests
              (we don't want anonymous spam-flags; sign-up gate filters that). */}
          {!isOwner && !isGuest && !reportOpen && (
            <button onClick={() => setReportOpen(true)}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors self-center mt-1">
              <span aria-hidden="true">⚑ </span>Report listing
            </button>
          )}
          {reportOpen && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-red-700">Why are you flagging this?</p>
              <select value={reportReason} onChange={e => setReportReason(e.target.value)}
                className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Pick a reason…</option>
                <option value="spam">Spam</option>
                <option value="scam">Scam or suspicious</option>
                <option value="inappropriate">Inappropriate / offensive</option>
                <option value="duplicate">Duplicate of another listing</option>
                <option value="other">Other</option>
              </select>
              <textarea value={reportDetails} onChange={e => setReportDetails(e.target.value)}
                placeholder="Details (optional)" rows={2} maxLength={500}
                className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-xs resize-none" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setReportOpen(false)} disabled={reportSubmitting}
                  className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-900">Cancel</button>
                <button onClick={handleSubmitReport} disabled={reportSubmitting || !reportReason}
                  className="text-xs px-4 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-bold rounded-lg transition-colors">
                  {reportSubmitting ? 'Sending…' : 'Submit report'}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function ListingCard({ listing, onClick, isLoggedIn, isSaved, onToggleSave }: {
  listing: Listing
  onClick: () => void
  isLoggedIn: boolean
  isSaved: boolean
  onToggleSave: (id: string) => void
}) {
  const photo = resolveImageUrl(listing.photo)
  // #7 perf: 64-wide thumb for the avatar (w-6 css = 24px); listing
  // photo stays full-size.
  const avatar = avatarUrl(listing.user.profilePhoto, 64)
  const cat   = CAT_META[listing.category]
  const emoji = CAT_EMOJI[listing.category] ?? '📌'

  return (
    /* Outer card was a <button> wrapping the whole tree. Save and
       Copy inside were <button>s too — button-in-button is invalid
       HTML and SR users heard "button inside button". Outer is now
       a role=button div with keyboard handlers; inner Save/Copy
       remain real <button>s with stopPropagation so the parent
       click doesn't fire when interacting with them. */
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className="block w-full overflow-hidden text-left bg-white rounded-2xl shadow-sm border border-gray-100 group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400">

      {/* Visual header */}
      {photo ? (
        <div className="relative w-full h-[200px] bg-gray-100 overflow-hidden">
          <Image
            src={photo}
            alt={listing.title}
            fill
            sizes="(min-width: 1024px) 400px, (min-width: 640px) 480px, 100vw"
            style={{ objectPosition: `center ${listing.photoPosition ?? 50}%` }}
            className="object-cover"
          />
          <div className="absolute top-3 left-3 flex items-center gap-1.5 flex-wrap">
            {cat && (
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cat.badge}`}>
                {cat.label}
              </span>
            )}
            {listing.price && (
              <span className="text-xs font-bold bg-white/95 text-gray-900 px-2.5 py-1 rounded-full shadow-sm">
                {listing.price}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={`relative h-[180px] bg-gradient-to-br ${cat?.header ?? 'from-amber-400 to-amber-500'} flex items-center justify-center overflow-hidden`}>
          <span aria-hidden="true" className="text-7xl opacity-60 select-none">{emoji}</span>
          <div className="absolute inset-0 bg-black/5" />
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            {cat && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/25 text-white backdrop-blur-sm">
                {cat.label}
              </span>
            )}
            {listing.price && (
              <span className="text-xs font-bold bg-white/95 text-gray-900 px-2.5 py-1 rounded-full shadow-sm">
                {listing.price}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-4 flex flex-col gap-2.5">
        <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2 group-hover:text-amber-600 transition-colors">{listing.title}</h3>
        <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">{listing.description}</p>
        {listing.neighborhood && (
          <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 self-start px-2 py-0.5 rounded-full">
            <span aria-hidden="true">📍 </span>{listing.neighborhood}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
          {avatar ? (
            <Image src={avatar} alt={listing.user.name} width={24} height={24} className="w-6 h-6 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
              style={{ backgroundColor: listing.user.color || '#f59e0b' }}>
              {listing.user.name[0]}
            </div>
          )}
          <p className="text-[11px] text-gray-600 truncate flex-1">{listing.user.name}</p>
          {isLoggedIn && (
          <button
            onClick={async e => {
              e.stopPropagation()
              onToggleSave(listing.id)
            }}
            aria-label={isSaved ? 'Unsave listing' : 'Save listing'}
            className={`p-1 transition-colors shrink-0 ${isSaved ? 'text-red-500' : 'text-gray-300 hover:text-red-400'}`}
            title={isSaved ? 'Unsave' : 'Save'}>
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          )}
          <button
            onClick={async e => {
              e.stopPropagation()
              const ok = await copyShare(listing.id)
              if (ok) toast.success('Link copied!')
            }}
            aria-label="Copy link to listing"
            className="p-1 text-gray-300 hover:text-amber-500 transition-colors shrink-0"
            title="Copy link">
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function ListingsInner() {
  const { user, isLoggedIn } = useAuth()
  const currentUserId = isLoggedIn ? user.id : null
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const [category, setCategory] = useState(() => {
    const tab = searchParams.get('tab')?.toUpperCase()
    return tab && CATEGORIES.some(c => c.id === tab) ? tab : 'ALL'
  })
  const [neighborhood, setNeighborhood] = useState(searchParams.get('neighborhood') ?? '')
  const [search, setSearch]             = useState(searchParams.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [total, setTotal]       = useState(0)
  const [hasMore, setHasMore]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<Listing | null>(null)
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set())
  const [alertCategories, setAlertCategories] = useState<string[]>([])
  const [showAlertMenu, setShowAlertMenu] = useState(false)
  const alertMenuRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Sync filter state back to the URL so the current view is
  // shareable. Previously only ?tab= was honored on mount and the
  // other filters lived in state only; pasting the URL elsewhere
  // dropped neighborhood + search. Uses replace so debounced search
  // keystrokes don't pile up browser history entries.
  useEffect(() => {
    const params = new URLSearchParams()
    if (category !== 'ALL')   params.set('tab',          category)
    if (neighborhood)         params.set('neighborhood', neighborhood)
    if (debouncedSearch)      params.set('q',            debouncedSearch)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [category, neighborhood, debouncedSearch, pathname, router])

  // Close alert menu on outside click OR Escape keypress so the
  // popover has keyboard parity with the click dismiss.
  useEffect(() => {
    if (!showAlertMenu) return
    function close(e: MouseEvent) {
      if (alertMenuRef.current && !alertMenuRef.current.contains(e.target as Node)) {
        setShowAlertMenu(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowAlertMenu(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [showAlertMenu])

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/me/listing-alerts', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAlertCategories(d.listingAlerts ?? []))
      .catch(() => {})
  }, [isLoggedIn])

  const fetchListings = useCallback(async (cat: string, nbhd: string, q: string, offset: number, append = false) => {
    const params = new URLSearchParams({ offset: String(offset) })
    if (cat === 'SAVED') {
      params.set('saved', 'true')
    } else if (cat === 'MINE') {
      params.set('mine', 'true')
    } else if (cat !== 'ALL') {
      params.set('category', cat)
    }
    if (nbhd) params.set('neighborhood', nbhd)
    if (q) params.set('q', q)
    const res  = await fetch(`/app/api/listings?${params}`, { credentials: 'include' })
    const data = await res.json()
    setListings(prev => append ? [...prev, ...data.listings] : data.listings)
    setSavedSet(prev => {
      const next = new Set(append ? prev : [])
      for (const id of (data.savedIds ?? [])) next.add(id)
      return next
    })
    setTotal(data.total)
    setHasMore(data.hasMore)
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchListings(category, neighborhood, debouncedSearch, 0).finally(() => setLoading(false))
  }, [category, neighborhood, debouncedSearch, fetchListings])

  // Auto-open listing from ?l= legacy share link
  const deepLinkId = searchParams.get('l')
  useEffect(() => {
    if (!deepLinkId) return
    fetch(`/app/api/listings/${deepLinkId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.id) setSelected(data) })
      .catch(() => {})
  }, [deepLinkId])

  async function loadMore() {
    setLoadingMore(true)
    await fetchListings(category, neighborhood, debouncedSearch, listings.length, true)
    setLoadingMore(false)
  }

  async function toggleSave(listingId: string) {
    const wasSaved = savedSet.has(listingId)
    setSavedSet(prev => {
      const next = new Set(prev)
      wasSaved ? next.delete(listingId) : next.add(listingId)
      return next
    })
    if (category === 'SAVED' && wasSaved) {
      setListings(prev => prev.filter(l => l.id !== listingId))
      setTotal(t => t - 1)
    }
    try {
      const res = await fetch(`/app/api/listings/${listingId}/save`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error()
      toast.success(wasSaved ? 'Removed from saved' : 'Saved!')
    } catch {
      setSavedSet(prev => {
        const next = new Set(prev)
        wasSaved ? next.add(listingId) : next.delete(listingId)
        return next
      })
    }
  }

  async function toggleAlert(catId: string) {
    const next = alertCategories.includes(catId)
      ? alertCategories.filter(c => c !== catId)
      : [...alertCategories, catId]
    setAlertCategories(next)
    try {
      await fetch('/app/api/me/listing-alerts', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingAlerts: next }),
      })
    } catch {
      setAlertCategories(alertCategories)
    }
  }

  // Confirmation already happened in the modal's two-state Delete
  // button — no need for a second native window.confirm here.
  async function handleDelete(id: string) {
    await fetch(`/app/api/listings/${id}`, { method: 'DELETE', credentials: 'include' })
    setListings(prev => prev.filter(l => l.id !== id))
    setTotal(t => t - 1)
  }

  async function handleMarkFilled(id: string) {
    const res = await fetch(`/app/api/listings/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'filled' }),
    })
    if (res.ok) {
      setListings(prev => prev.filter(l => l.id !== id))
      setTotal(t => t - 1)
    }
  }

  async function handleRenew(id: string) {
    const res = await fetch(`/app/api/listings/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renew: true }),
    })
    if (res.ok) {
      const updated = await res.json()
      setListings(prev => prev.map(l => l.id === id ? { ...l, expiresAt: updated.expiresAt } : l))
    }
  }

  const activeCat = CATEGORIES.find(c => c.id === category)

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">
      {selected && (
        <ListingModal
          listing={selected}
          currentUserId={currentUserId}
          isLoggedIn={isLoggedIn}
          isSaved={savedSet.has(selected.id)}
          onToggleSave={toggleSave}
          onClose={() => setSelected(null)}
          onDelete={id => { handleDelete(id); setSelected(null) }}
          onMarkFilled={id => { handleMarkFilled(id); setSelected(null) }}
          onRenew={handleRenew}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-5">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-3 py-1.5 mb-4">
                📋 Classifieds
              </span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Community Board</h1>
              <p className="text-base text-gray-600 mt-1 max-w-xl">
                Rooms, jobs, services & more — posted by Smileys members for Smileys members.
              </p>
              {/* Share the whole board. cacheKey pins a ?v= suffix so X / Facebook
                  cache a URL that already has the cover image — the bare /board URL
                  can stay stuck on an old blank scrape (X has no re-scrape tool).
                  Bump the key if the board cover image changes. */}
              <div className="mt-4">
                <SocialShare
                  compact
                  context="board"
                  title="Smileys Community Board — rooms, jobs, services & more in Istanbul"
                  url={`${APP_URL}/board`}
                  cacheKey="1"
                />
              </div>
            </div>
            <Link
              href={isLoggedIn ? '/board/new' : '/login?return=/board/new'}
              className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shrink-0 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {isLoggedIn ? 'Post a listing' : 'Sign in to post'}
            </Link>
          </div>

          {/* Search bar */}
          <div className="relative mb-4">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search listings…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"><span aria-hidden="true">×</span></button>
            )}
          </div>

          {/* Category pills sit on their own row at every breakpoint.
              The neighborhood select + alert bell drop to a row below
              so the rightmost pills never collide with the select on
              desktop — earlier attempts to fit both in one row kept
              breaking on certain widths. */}
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="relative min-w-0 overflow-hidden -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                {CATEGORIES.filter(c => isLoggedIn || !c.memberOnly).map(cat => {
                const isActive = category === cat.id
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                      isActive
                        ? cat.activeCls
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span aria-hidden="true">{cat.emoji}</span>
                    {cat.label}
                    {cat.id === 'ALL' && !loading && !debouncedSearch && (
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-400'}`}>
                        {total}
                      </span>
                    )}
                  </button>
                )
              })}
              </div>
              {/* Right-edge fade — visually separates the scrollable pill
                  row from the neighborhood select on its right. Without
                  this the last pill clipped right up against the select.
                  pointer-events-none so clicks still reach the pill. */}
              <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-white to-transparent hidden sm:block" />
            </div>

            <div className="flex items-center gap-2 shrink-0">
            {/* Neighborhood filter */}
            <select
              value={neighborhood}
              onChange={e => setNeighborhood(e.target.value)}
              className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-full border whitespace-nowrap transition-colors ${
                neighborhood
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
              title="Filter by neighborhood"
            >
              <option value="">All areas</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            {isLoggedIn && (
            <div className="relative shrink-0" ref={alertMenuRef}>
              <button
                onClick={() => setShowAlertMenu(v => !v)}
                className={`relative flex items-center justify-center w-9 h-9 rounded-full border transition-all ${
                  alertCategories.length > 0
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
                title="Listing alerts"
              >
                <svg className="w-4 h-4" fill={alertCategories.length > 0 ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {alertCategories.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                    {alertCategories.length}
                  </span>
                )}
              </button>

              {showAlertMenu && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-20 w-60">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Email me when new…</p>
                  <div className="space-y-1">
                    {ALERT_CATS.map(cat => (
                      <label key={cat.id} className="flex items-center gap-3 py-1.5 cursor-pointer group">
                        <div
                          onClick={() => toggleAlert(cat.id)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                            alertCategories.includes(cat.id)
                              ? 'bg-amber-500 border-amber-500'
                              : 'border-gray-300 group-hover:border-amber-400'
                          }`}
                        >
                          {alertCategories.includes(cat.id) && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span onClick={() => toggleAlert(cat.id)} className="text-sm text-gray-700 select-none"><span aria-hidden="true">{cat.emoji}</span> {cat.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">You'll get one email per new listing that matches.</p>
                </div>
              )}
            </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Mobile post button */}
        <div className="sm:hidden mb-6">
          <Link
            href={isLoggedIn ? '/board/new' : '/login?return=/board/new'}
            className="flex items-center justify-center gap-2 w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {isLoggedIn ? 'Post a listing' : 'Sign in to post'}
          </Link>
        </div>

        {/* Active filter label */}
        {!loading && listings.length > 0 && (
          <p className="text-sm text-gray-600 mb-5">
            {debouncedSearch
              ? <><strong className="text-gray-900 font-bold">{total}</strong> result{total !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;</>
              : <><strong className="text-gray-900 font-bold">{total}</strong>{' '}
                  {category === 'ALL' ? 'active listing' : category === 'SAVED' ? 'saved listing' : activeCat?.label.toLowerCase() + ' listing'}{total !== 1 ? 's' : ''}</>
            }
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(8)].map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">
              {debouncedSearch ? '🔍' : category === 'SAVED' ? '❤️' : activeCat?.emoji ?? '📋'}
            </div>
            <p className="text-xl font-bold text-gray-700">
              {debouncedSearch
                ? `No results for "${debouncedSearch}"`
                : category === 'SAVED'
                ? 'No saved listings yet'
                : category === 'ALL' ? 'No listings yet' : `No ${activeCat?.label.toLowerCase()} listings`}
            </p>
            <p className="text-sm text-gray-400 mt-2 mb-8">
              {debouncedSearch
                ? 'Try a different search term'
                : category === 'SAVED'
                ? 'Tap the heart on any listing to save it for later'
                : category === 'ALL'
                ? 'Be the first to post something for the community'
                : `Switch to All to see everything, or post a ${activeCat?.label.toLowerCase()} listing`}
            </p>
            {category !== 'SAVED' && !debouncedSearch && (
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link
                  href={isLoggedIn ? '/board/new' : '/login?return=/board/new'}
                  className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-6 py-3 rounded-xl transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {isLoggedIn ? 'Post a listing' : 'Sign in to post'}
                </Link>
                {category !== 'ALL' && (
                  <button
                    onClick={() => setCategory('ALL')}
                    className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-600 text-sm font-semibold px-6 py-3 rounded-xl hover:border-gray-300 transition-colors"
                  >
                    View all listings
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map(l => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  onClick={() => setSelected(l)}
                  isLoggedIn={isLoggedIn}
                  isSaved={savedSet.has(l.id)}
                  onToggleSave={toggleSave}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-8 py-3 rounded-2xl bg-white border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:border-amber-400 hover:text-amber-600 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function ListingsPage() {
  return (
    <Suspense>
      <ListingsInner />
    </Suspense>
  )
}
