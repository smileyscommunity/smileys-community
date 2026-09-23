'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { recoverFromStaleChunk } from '@/lib/staleChunk'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Route React error-boundary crashes to PostHog error tracking. PostHog's
    // capture_exceptions only autocaptures *unhandled* errors; a boundary
    // catches the error first, so without this explicit capture these render
    // crashes would go untracked.
    posthog.captureException(error)
    // Stale chunk after a deploy — reload once and pull fresh bundles rather
    // than leaving someone on "Something went wrong". The rule and the
    // one-per-minute guard live in lib/staleChunk so this boundary and the
    // global one cannot recognise different sets of patterns, which is
    // exactly what had happened.
    recoverFromStaleChunk(error)
  }, [error])

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-6">⚠️</div>
        <h1 className="text-2xl font-extrabold text-gray-900 mb-3">Something went wrong</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">
          An unexpected error occurred. We've been notified and will look into it.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors"
          >
            Try again
          </button>
          {/* Intentionally a plain <a>, not next/link: this is the global
              error boundary, so the React tree is already broken. A
              client-side navigation would keep that broken tree mounted —
              a full document load is what actually recovers the app. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/app"
            className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-sm transition-colors"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  )
}
