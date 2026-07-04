'use client'

// Client bits embedded inside the server-rendered detail page.
// The page itself is RSC (for SEO + JSON-LD); this component holds
// the action row (save / claim / report / write-review / owner-edit)
// plus the modal trigger state. Everything reuses the same widgets
// the directory grid already ships.

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import DirectorySaveButton from '@/components/DirectorySaveButton'
import DirectoryReportButton from '@/components/DirectoryReportButton'
import DirectoryOwnerEdit from '@/components/DirectoryOwnerEdit'
import DirectoryReviews from '@/components/DirectoryReviews'

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

interface Props {
  business:          BusinessSummary
  initialIsSaved:    boolean
  initialMyReviewId: string | null
  currentUserId:     string | null
  ownerEditPayload:  OwnerEditPayload
}

export default function DetailClient({
  business, initialIsSaved, initialMyReviewId, currentUserId, ownerEditPayload,
}: Props) {
  const [reviewsOpen, setReviewsOpen] = useState(false)
  const isGuest = !currentUserId

  // Soft refresh after a write — toast plus a hint for the user, since
  // we can't unilaterally re-fetch a server component from the client.
  function softRefresh(message?: string) {
    if (message) toast.success(message)
    // Page-level reload picks up the new aggregate counts + JSON-LD.
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-gray-100">
        {/* Save + Write-review — member actions. Guests get a single
            "Sign in to save / review" CTA that returns them here after
            login, instead of clicking save and getting a generic 401
            toast. */}
        {isGuest ? (
          <Link
            href={`/login?return=/directory/${business.id}`}
            className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-3 py-1.5 transition-colors"
          >
            Sign in to save or review
          </Link>
        ) : (
          <>
            <DirectorySaveButton
              businessId={business.id}
              businessName={business.name}
              initialSaved={initialIsSaved}
            />
            <button
              onClick={() => setReviewsOpen(true)}
              className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-3 py-1.5 transition-colors"
            >
              ★ {initialMyReviewId ? 'Edit my review' : 'Write a review'}
            </button>
          </>
        )}

        {/* Verified-owner self-edit — only visible to the owner. */}
        {business.isMine && (
          <DirectoryOwnerEdit
            b={ownerEditPayload}
            onSaved={() => softRefresh('Saved')}
          />
        )}

        {/* Claim CTA — only when no verified owner yet. Links back to
            /directory where the in-place claim chip lives. Hidden for
            guests; the claim flow requires a signed-in account anyway. */}
        {!business.hasClaimedOwner && !isGuest && (
          <Link
            href="/directory"
            className="text-xs font-semibold text-gray-600 hover:text-amber-700 hover:underline"
            title="Open claim flow on /directory"
          >
            Is this your business?
          </Link>
        )}

        {/* Report a problem — member-only (anon spam-flags would be
            noisy). */}
        {!isGuest && (
          <div className="ml-auto">
            <DirectoryReportButton businessId={business.id} businessName={business.name} />
          </div>
        )}
      </div>

      {/* Reviews drawer — full read/write surface. We open it from
          the action row above; the server-rendered reviews list on
          the page below already serves the SEO read path. */}
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
