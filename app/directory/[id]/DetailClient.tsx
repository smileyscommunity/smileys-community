'use client'

// Client bits embedded inside the server-rendered detail page.
// The page itself is RSC (for SEO + JSON-LD); this file holds the
// interactive pieces, split by where they render so each action sits
// with the content it belongs to:
//
//   HeaderActions — save / share / owner-edit, in the header card
//   ReviewCta     — write/edit-review button + drawer, in the Reviews
//                   section header (next to the list it feeds)
//   FooterActions — claim + report, quiet links at the page bottom
//
// Everything reuses the same widgets the directory grid already ships.

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import DirectorySaveButton from '@/components/DirectorySaveButton'
import DirectoryReportButton from '@/components/DirectoryReportButton'
import DirectoryOwnerEdit from '@/components/DirectoryOwnerEdit'
import DirectoryReviews from '@/components/DirectoryReviews'
import SocialShare from '@/components/SocialShare'
import { APP_URL } from '@/lib/env'

interface BusinessSummary {
  id: string
  name: string
  hasClaimedOwner: boolean
  isMine: boolean
  isStaff: boolean
}

// Same shape DirectoryOwnerEdit accepts. We replicate the field set
// here to avoid a circular dependency on the component's internal
// types.
interface OwnerEditPayload {
  id: string
  name: string
  category: string
  description: string
  neighborhood: string | null
  address: string | null
  phone: string | null
  website: string | null
  instagram: string | null
  languages: string | null
  hours: Record<string, string | null> | null
  memberDiscount: string | null
  tags: string[]
}

// Soft refresh after a write — toast plus a full reload, since we
// can't unilaterally re-fetch a server component from the client.
// Page-level reload picks up the new aggregate counts + JSON-LD.
function softRefresh(message?: string) {
  if (message) toast.success(message)
  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}

// ── Header card: save / share / owner-edit ─────────────────────────
export function HeaderActions({
  business, initialIsSaved, currentUserId, ownerEditPayload,
}: {
  business:         BusinessSummary
  initialIsSaved:   boolean
  currentUserId:    string | null
  ownerEditPayload: OwnerEditPayload
}) {
  const isGuest = !currentUserId
  return (
    <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-gray-100">
      {isGuest ? (
        // Guests get a login CTA that returns them here, instead of
        // clicking save and getting a generic 401 toast.
        <Link
          href={`/login?return=/directory/${business.id}`}
          className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-3 py-1.5 transition-colors"
        >
          Sign in to save or review
        </Link>
      ) : (
        <DirectorySaveButton
          businessId={business.id}
          businessName={business.name}
          initialSaved={initialIsSaved}
        />
      )}

      {/* Verified-owner self-edit — only visible to the owner. */}
      {business.isMine && (
        <DirectoryOwnerEdit
          b={ownerEditPayload}
          onSaved={() => softRefresh('Saved')}
        />
      )}

      {/* Share — public (guests included) so members and visitors can
          spread the word about a business on WhatsApp / social. Compact
          icon row so it sits inline with Save instead of rendering the
          full card variant. */}
      <div className="ml-auto">
        <SocialShare compact title={business.name} url={`${APP_URL}/directory/${business.id}`} />
      </div>
    </div>
  )
}

// ── Reviews section: write/edit CTA + drawer ───────────────────────
export function ReviewCta({
  business, initialMyReviewId, currentUserId,
}: {
  business:          BusinessSummary
  initialMyReviewId: string | null
  currentUserId:     string | null
}) {
  const [reviewsOpen, setReviewsOpen] = useState(false)

  if (!currentUserId) {
    return (
      <Link
        href={`/login?return=/directory/${business.id}`}
        className="text-xs font-semibold text-amber-700 hover:underline shrink-0"
      >
        Sign in to review
      </Link>
    )
  }

  return (
    <>
      <button
        onClick={() => setReviewsOpen(true)}
        className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-3 py-1.5 transition-colors shrink-0"
      >
        ★ {initialMyReviewId ? 'Edit my review' : 'Write a review'}
      </button>

      {/* Reviews drawer — full read/write surface. The server-rendered
          reviews list on the page serves the SEO read path. */}
      {reviewsOpen && (
        <DirectoryReviews
          businessId={business.id}
          businessName={business.name}
          currentUserId={currentUserId}
          isOwner={business.isMine}
          onChange={() => softRefresh()}
          onClose={() => setReviewsOpen(false)}
        />
      )}
    </>
  )
}

// ── Page footer: claim + report, low-key housekeeping links ────────
export function FooterActions({
  business, currentUserId, initialMyClaimStatus,
}: {
  business:             BusinessSummary
  currentUserId:        string | null
  initialMyClaimStatus: string | null
}) {
  const [claimStatus, setClaimStatus] = useState(initialMyClaimStatus)
  const [claimOpen,   setClaimOpen]   = useState(false)
  const [message,     setMessage]     = useState('')
  const [busy,        setBusy]        = useState(false)

  // Both actions require a signed-in account (anon spam-flags would
  // be noisy); guests see nothing here.
  if (!currentUserId) return null

  // Claim submits right here — previously this linked to /directory
  // and left the user hunting the grid for the card's claim chip.
  async function submitClaim() {
    if (!message.trim()) {
      toast.error('Tell us why you own this business')
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/app/api/directory/${business.id}/claim`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to submit claim'); return }
      toast.success('Claim submitted — an admin will review it')
      setClaimOpen(false)
      setMessage('')
      setClaimStatus('pending')
    } catch {
      toast.error('Network error — not submitted')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      {claimOpen && !business.hasClaimedOwner && claimStatus !== 'pending' && (
        <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-4 text-left">
          <p className="text-xs font-bold text-gray-900 mb-1.5">Verify you own &ldquo;{business.name}&rdquo;</p>
          <p className="text-[11px] text-gray-600 mb-2 leading-tight">
            How are you the owner? An email at the business domain, your name on the lease, or anything verifiable.
          </p>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            autoFocus
            placeholder="e.g. I'm the founder; my email is owner@example.com"
            className="w-full text-xs bg-gray-50 border border-gray-200 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={submitClaim}
              disabled={busy}
              className="flex-1 text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-1.5 transition-colors disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Submit claim'}
            </button>
            <button
              onClick={() => { setClaimOpen(false); setMessage('') }}
              className="text-[11px] font-semibold text-gray-600 hover:text-gray-700 rounded-lg py-1.5 px-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-5">
        {!business.hasClaimedOwner && (
          claimStatus === 'pending' ? (
            <span className="text-xs text-amber-600 italic">Claim pending review</span>
          ) : (
            <button
              onClick={() => setClaimOpen(o => !o)}
              className="text-xs font-semibold text-gray-500 hover:text-amber-700 hover:underline"
            >
              {claimStatus === 'rejected' ? 'Claim rejected — try again' : 'Is this your business?'}
            </button>
          )
        )}
        <DirectoryReportButton businessId={business.id} businessName={business.name} />
      </div>
    </div>
  )
}
