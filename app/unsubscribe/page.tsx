'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

function UnsubscribePage() {
  const params = useSearchParams()
  const done   = params.get('done')
  const error  = params.get('error')

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
        {done ? (
          <>
            <div className="text-4xl mb-4">✓</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Unsubscribed</h1>
            <p className="text-gray-500 text-sm mb-6">
              You've been removed from Smileys Community newsletters and announcements.
              You'll still receive transactional emails (event confirmations, account updates).
            </p>
            <Link href="/app/events" className="inline-block px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
              Browse events
            </Link>
          </>
        ) : error ? (
          <>
            <div className="text-4xl mb-4">✕</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid link</h1>
            <p className="text-gray-500 text-sm mb-6">
              This unsubscribe link is invalid or has expired. Please contact us if you'd like to opt out.
            </p>
            <Link href="/app/contact" className="inline-block px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold transition-colors">
              Contact us
            </Link>
          </>
        ) : (
          <p className="text-gray-400 text-sm">Processing…</p>
        )}
      </div>
    </main>
  )
}

export default function Page() {
  return <Suspense><UnsubscribePage /></Suspense>
}
