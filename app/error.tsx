'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Route React error-boundary crashes to PostHog error tracking. PostHog's
    // capture_exceptions only autocaptures *unhandled* errors; a boundary
    // catches the error first, so without this explicit capture these render
    // crashes would go untracked.
    posthog.captureException(error)
    // Stale chunk after a deploy — the cached client bundle references a
    // module ID that the new server build doesn't ship, so webpack-runtime
    // throws on the missing factory. Auto-reload pulls fresh bundles
    // instead of leaving the user on "Something went wrong" until they
    // manually hard-refresh. Patterns observed in prod:
    //   - "Cannot find module" / "ChunkLoadError" / "Loading chunk"
    //   - "Cannot read properties of undefined (reading 'call')" from
    //     webpack-runtime.js — same root cause surfaced differently when
    //     a server component references a chunk that vanished from the
    //     new build (the digest in pm2 logs is the giveaway).
    const msg = error?.message ?? ''
    const stack = error?.stack ?? ''
    const isStaleChunk =
      msg.includes('Cannot find module') ||
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk') ||
      (msg.includes("Cannot read properties of undefined (reading 'call')") && stack.includes('webpack-runtime'))
    if (isStaleChunk) {
      window.location.reload()
    }
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
