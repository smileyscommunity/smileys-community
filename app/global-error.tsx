'use client'

import posthog from 'posthog-js'
import { useEffect } from 'react'
import { BRAND_AMBER } from '@/lib/constants'
import { recoverFromStaleChunk } from '@/lib/staleChunk'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    posthog.captureException(error)
    // Was three patterns inline here while app/error.tsx matched four, and the
    // missing one — "reading 'call'" out of webpack-runtime — is the pattern a
    // SERVER component referencing a vanished chunk raises. That crash lands on
    // THIS boundary, not the route one, so the boundary best placed to recover
    // was the only one that could not, and a device sat on "Something went
    // wrong" through reloads. Both now read the rule from lib/staleChunk.
    recoverFromStaleChunk(error)
  }, [error])

  return (
    <html>
      <body>
        <main style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ maxWidth: '448px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>⚠️</div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#111827', marginBottom: '12px' }}>Something went wrong</h1>
            <p style={{ color: '#6b7280', marginBottom: '32px', lineHeight: '1.6' }}>
              An unexpected error occurred. Please try refreshing the page.
            </p>
            <button
              onClick={reset}
              style={{ padding: '12px 24px', borderRadius: '12px', background: BRAND_AMBER, color: '#fff', fontWeight: 600, fontSize: '14px', border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
