'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

// Staff's hide/unhide on a directory review (PATCH /api/admin/directory/
// reviews/[id], city-scoped there). The endpoint existed with no control
// anywhere, so "hidden by admin" could not happen.
export default function StaffReviewHide({ reviewId, hidden }: { reviewId: string; hidden: boolean }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  async function toggle() {
    if (!hidden && !(await confirmToast('Hide this review from the page and the rating?', { confirmLabel: 'Hide' }))) return
    setBusy(true)
    try {
      const res = await fetch(`/app/api/admin/directory/reviews/${reviewId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide: !hidden }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(typeof d?.error === 'string' ? d.error : "Couldn't change it.")
        return
      }
      toast.success(hidden ? 'Review shown again' : 'Review hidden')
      router.refresh()
    } catch {
      toast.error('No connection — nothing was changed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button onClick={toggle} disabled={busy}
      className="text-[11px] font-semibold text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50">
      {busy ? '…' : hidden ? 'Unhide' : 'Hide'}
    </button>
  )
}
