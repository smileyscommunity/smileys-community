'use client'

// One-click landing from the listing-expiry email: renew for 30 days, or
// mark it filled/sold so the board stays honest. Deliberately does NOT
// fetch the listing first — GET /api/listings/[id] only serves active
// listings, and this page's whole audience is people whose listing is
// about to lapse (or just did). The PATCH endpoint owns all authorization
// (owner-or-admin, deleted-is-terminal); this page just gives its two
// actions a tappable home.

import { use, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

export default function RenewListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [done, setDone]       = useState<'renewed' | 'filled' | null>(null)
  const [working, setWorking] = useState(false)

  async function act(body: Record<string, unknown>, result: 'renewed' | 'filled') {
    setWorking(true)
    try {
      const res = await fetch(`/app/api/listings/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not update the listing'); return }
      setDone(result)
    } catch {
      toast.error('Network error')
    } finally {
      setWorking(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-warm">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-20 text-center">
          <span aria-hidden="true" className="text-5xl block mb-4">{done === 'renewed' ? '✅' : '🎉'}</span>
          <h1 className="text-2xl font-extrabold text-gray-900">
            {done === 'renewed' ? 'Renewed for 30 more days' : 'Marked as filled'}
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            {done === 'renewed'
              ? 'Your listing is live on the Community Board again.'
              : 'Glad it worked out — the board stays honest when filled listings say so.'}
          </p>
          <Link href="/board" className="inline-block mt-8 bg-amber-500 hover:bg-amber-600 text-white font-bold px-8 py-3.5 rounded-xl transition-colors">
            Back to the board
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-warm">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-20 text-center">
        <span aria-hidden="true" className="text-5xl block mb-4">⏳</span>
        <h1 className="text-2xl font-extrabold text-gray-900">Is this listing still open?</h1>
        <p className="text-sm text-gray-600 mt-2">
          Renew it to keep it on the board for another 30 days — or close it out if it&apos;s done.
        </p>
        <div className="flex flex-col gap-3 mt-8">
          <button
            onClick={() => act({ renew: true }, 'renewed')}
            disabled={working}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold px-8 py-3.5 rounded-xl transition-colors"
          >
            {working ? 'Working…' : 'Yes — renew for 30 days'}
          </button>
          <button
            onClick={() => act({ status: 'filled' }, 'filled')}
            disabled={working}
            className="bg-white border border-gray-200 hover:border-gray-300 disabled:opacity-50 text-gray-700 font-bold px-8 py-3.5 rounded-xl transition-colors"
          >
            It&apos;s filled / sold — close it
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-6">Only the listing&apos;s owner can do this.</p>
      </div>
    </div>
  )
}
