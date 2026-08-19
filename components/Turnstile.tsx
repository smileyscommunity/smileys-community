'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile: {
      render:  (el: HTMLElement, opts: object) => string
      remove:  (id: string) => void
      reset:   (id: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

interface Props {
  onVerify: (token: string) => void
  onExpire?: () => void
  // Tokens are single-use: a failed submit consumes the current one and
  // every retry with it fails verification until the page is reloaded.
  // Bump this counter after a failed submit to make the widget mint a
  // fresh token (onVerify fires again when it's ready).
  resetSignal?: number
}

const SITE_KEY  = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit'

export default function Turnstile({ onVerify, onExpire, resetSignal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId     = useRef<string | null>(null)
  const onVerifyRef  = useRef(onVerify)
  onVerifyRef.current = onVerify
  // 'failed' surfaces a load/render/challenge failure so the user gets a
  // reason + a retry instead of a silently-stuck, disabled login button.
  const [failed, setFailed] = useState(false)
  // Bumped by the "Try again" button to re-run the mount effect.
  const [retry, setRetry]   = useState(0)

  useEffect(() => {
    if (!SITE_KEY) return
    setFailed(false)

    function mount() {
      if (!containerRef.current || !window.turnstile) return
      // Re-render cleanly on retry (an old widget may be in an error state).
      if (widgetId.current) { try { window.turnstile.remove(widgetId.current) } catch {} widgetId.current = null }
      try {
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey:            SITE_KEY,
          callback:           (token: string) => { setFailed(false); onVerifyRef.current(token) },
          // A Turnstile token dies after ~5 minutes, which any real login page
          // reaches — open the tab, get distracted, come back. This used to
          // null the widget id, and resetting NEEDS that id, so the reset path
          // below became a permanent no-op: the token was gone, no new one
          // could be issued, and the only way out was a full page reload.
          // Submitting in that state is what produced the run of
          // 'timeout-or-duplicate' / 'missing-input-response' rejections and
          // the "human verification failed" that wouldn't clear.
          //
          // Keep the handle and reset in place instead: Cloudflare issues a
          // fresh challenge and the parent gets a new token via `callback`.
          'expired-callback': () => {
            onExpire?.()
            if (widgetId.current && window.turnstile) {
              try { window.turnstile.reset(widgetId.current) } catch { setFailed(true) }
            }
          },
          // Fires on network error, domain/config mismatch, or challenge
          // failure — without this the widget just vanishes with no signal.
          // Return nothing so Cloudflare still runs its own auto-retry.
          'error-callback':   () => { setFailed(true) },
          theme:              'light',
          size:               'normal',
        })
      } catch {
        setFailed(true)
      }
    }

    // If already loaded, mount immediately.
    if (window.turnstile) {
      mount()
    } else {
      window.onTurnstileLoad = mount
      let script = document.querySelector<HTMLScriptElement>('script[src*="turnstile"]')
      if (!script) {
        script = document.createElement('script')
        script.src   = SCRIPT_SRC
        script.async = true
        script.defer = true
        // NOTE: intentionally NOT setting crossOrigin='anonymous'. That forces
        // a CORS-mode fetch, and on networks/proxies that don't echo CORS
        // headers for challenges.cloudflare.com the script fails to load and
        // Turnstile never renders. A plain cross-origin script is more robust.
        script.onerror = () => setFailed(true)
        document.head.appendChild(script)
      } else if (!window.turnstile) {
        // Script tag exists but hasn't finished loading — attach an error hook.
        script.addEventListener('error', () => setFailed(true), { once: true })
      }
    }

    return () => { if (widgetId.current) { try { window.turnstile?.remove(widgetId.current) } catch {} } }
  }, [retry])

  useEffect(() => {
    if (!resetSignal) return
    // A parent bumps this after a rejected submit, which is exactly when the
    // widget may have no live handle (expired, removed, script reloaded). A
    // bare reset() silently did nothing there and the form could never get
    // another token — so fall back to a full re-mount, which always can.
    if (widgetId.current && window.turnstile) {
      try { window.turnstile.reset(widgetId.current) } catch { setRetry(n => n + 1) }
    } else {
      setRetry(n => n + 1)
    }
  }, [resetSignal])

  if (!SITE_KEY) return null

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className="flex justify-center" />
      {failed && (
        <div className="text-center text-xs text-gray-500">
          <p>Security check couldn’t load. Disable ad/privacy blockers for this site, or try a different network or browser.</p>
          <button
            type="button"
            onClick={() => { setFailed(false); setRetry(n => n + 1) }}
            className="mt-1 font-semibold text-amber-600 hover:text-amber-700">
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
