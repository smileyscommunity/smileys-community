'use client'

import { useEffect, useRef } from 'react'

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

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

export default function Turnstile({ onVerify, onExpire, resetSignal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId     = useRef<string | null>(null)
  const onVerifyRef  = useRef(onVerify)
  onVerifyRef.current = onVerify

  useEffect(() => {
    if (!SITE_KEY) return

    function mount() {
      if (!containerRef.current || !window.turnstile || widgetId.current) return
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey:            SITE_KEY,
        callback:           (token: string) => onVerifyRef.current(token),
        'expired-callback': () => { onExpire?.(); widgetId.current = null },
        theme:              'light',
        size:               'normal',
      })
    }

    // If already loaded, mount immediately
    if (window.turnstile) {
      mount()
    } else {
      // Inject script manually so we control the callback
      window.onTurnstileLoad = mount
      if (!document.querySelector('script[src*="turnstile"]')) {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit'
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
    }

    return () => { if (widgetId.current) window.turnstile?.remove(widgetId.current) }
  }, [])

  useEffect(() => {
    if (!resetSignal) return
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
  }, [resetSignal])

  if (!SITE_KEY) return null

  return <div ref={containerRef} className="flex justify-center" />
}
