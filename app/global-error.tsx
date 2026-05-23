'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
    if (error?.message?.includes('Cannot find module') || error?.message?.includes('ChunkLoadError') || error?.message?.includes('Loading chunk')) {
      window.location.reload()
    }
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
              style={{ padding: '12px 24px', borderRadius: '12px', background: '#f59e0b', color: '#fff', fontWeight: 600, fontSize: '14px', border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
