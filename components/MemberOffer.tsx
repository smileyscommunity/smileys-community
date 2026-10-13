'use client'

import { useState } from 'react'
import { track } from '@/lib/analytics'

interface Offer { label: string; url: string | null; code: string | null; note: string | null }

// Members-only. The offer is NOT in the page: this fetches it from
// /api/posts/[slug]/offer, which re-checks membership on the server. The
// analytics event carries the article slug only — never the link or code.
export default function MemberOffer({ slug }: { slug: string }) {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function reveal() {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/app/api/posts/${encodeURIComponent(slug)}/offer`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) { setError(res.status === 429 ? 'Please wait a moment and try again.' : 'This offer is not available to your account right now.'); return }
      setOffer(await res.json())
      track('member_offer_reveal', { article_slug: slug })
    } catch { setError('Could not load the offer. Please try again.') }
    finally { setLoading(false) }
  }

  return (
    <aside aria-label="Member offer" className="mb-10 rounded-2xl border border-violet-200 bg-violet-50 p-5">
      <h2 className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-2">Member offer</h2>
      {offer ? (
        <div className="text-sm text-gray-800 space-y-2">
          <p className="font-semibold">{offer.label}</p>
          {offer.code && <p>Code: <code className="px-2 py-0.5 rounded bg-white border border-violet-200 font-mono select-all">{offer.code}</code></p>}
          {offer.url && <p><a href={offer.url} target="_blank" rel="noopener noreferrer nofollow" className="text-violet-700 font-semibold underline">Open your member link ↗</a></p>}
          {offer.note && <p className="text-gray-600">{offer.note}</p>}
          <p className="text-xs text-gray-500">For Smileys members only. Please don&apos;t share it on social media.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-3">As a Smileys member you have an offer for this event.</p>
          <button onClick={reveal} disabled={loading} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm disabled:opacity-60">
            {loading ? 'Loading…' : 'Show my member offer'}
          </button>
          {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
        </>
      )}
    </aside>
  )
}
