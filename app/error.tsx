'use client'

import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
    // Stale chunk after a deploy — hard reload to pick up new bundles
    if (error?.message?.includes('Cannot find module') || error?.message?.includes('ChunkLoadError') || error?.message?.includes('Loading chunk')) {
      window.location.reload()
    }
  }, [error])

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-6">⚠️</div>
        <h1 className="text-2xl font-extrabold text-gray-900 mb-3">Something went wrong</h1>
        <p className="text-gray-500 mb-8 leading-relaxed">
          An unexpected error occurred. We've been notified and will look into it.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors"
          >
            Try again
          </button>
          <a
            href="/app/"
            className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-sm transition-colors"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  )
}
