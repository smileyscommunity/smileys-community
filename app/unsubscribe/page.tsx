'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import Link from 'next/link'

function UnsubscribePage() {
  const params = useSearchParams()
  const uid = params.get('uid')
  const t   = params.get('t')
  // 'done'/'error' query params kept for any old redirect-style links still
  // in inboxes; fresh links land on the confirm step. The explicit button
  // (rather than unsubscribing on page load) keeps mail scanners that
  // prefetch links from silently opting members out.
  const [phase, setPhase] = useState<'confirm' | 'working' | 'done' | 'error'>(
    params.get('done') ? 'done' : params.get('error') || !uid || !t ? 'error' : 'confirm'
  )

  async function confirm() {
    setPhase('working')
    try {
      const res = await fetch('/app/api/unsubscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ uid, t }),
      })
      setPhase(res.ok ? 'done' : 'error')
    } catch {
      setPhase('error')
    }
  }

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
        {phase === 'done' ? (
          <>
            <div className="text-4xl mb-4">✓</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Unsubscribed</h1>
            <p className="text-gray-600 text-sm mb-6">
              You've been removed from Smileys Community newsletters and announcements.
              You'll still receive transactional emails (event confirmations, account updates).
            </p>
            <Link href="/events" className="inline-block px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
              Browse events
            </Link>
          </>
        ) : phase === 'error' ? (
          <>
            <div className="text-4xl mb-4">✕</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid link</h1>
            <p className="text-gray-600 text-sm mb-6">
              This unsubscribe link is invalid or has expired. Please contact us if you'd like to opt out.
            </p>
            <Link href="/contact" className="inline-block px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold transition-colors">
              Contact us
            </Link>
          </>
        ) : (
          <>
            <div className="text-4xl mb-4">📭</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Unsubscribe from newsletters?</h1>
            <p className="text-gray-600 text-sm mb-6">
              You'll stop receiving Smileys Community newsletters and announcements.
              Transactional emails (event confirmations, account updates) continue.
            </p>
            <button
              onClick={confirm}
              disabled={phase === 'working'}
              className="inline-block px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {phase === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
            </button>
          </>
        )}
      </div>
    </main>
  )
}

export default function Page() {
  return <Suspense><UnsubscribePage /></Suspense>
}
