'use client'

import { useEffect, useRef, useState } from 'react'

// The parts of an enquiry form that are the same on every page: honeypot, human
// check, time-on-page, the ?src= channel tag, and the submit/error/success
// states. A page owns its own fields and what it POSTs; this owns everything
// that must behave identically so the two forms cannot drift apart.
//
// Success is only ever "the server said ok:true" — a non-2xx, a body without
// ok:true, or a network failure all land in `error`, and the single-use
// Turnstile token is refreshed so the visitor can retry.
export function useEnquirySubmit(endpoint: string) {
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const loadedAt = useRef(Date.now())
  // Channel tag from the link (?src=newsletter-oct), read in the browser so the
  // page stays cacheable. Only a short [a-z0-9_-] label is ever sent (the API
  // re-validates it).
  const src = useRef('')
  useEffect(() => { try { src.current = new URLSearchParams(window.location.search).get('src') ?? '' } catch { /* optional */ } }, [])

  const freshToken = () => { setTurnstileToken(''); setTurnstileReset(n => n + 1) }

  async function submit(fields: Record<string, unknown>): Promise<boolean> {
    if (loading) return false
    setError(''); setLoading(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, src: src.current, _hp: honeypot, _t: loadedAt.current, _cf: turnstileToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok !== true) {
        setError(data.error ?? 'Something went wrong. Please try again, or email us directly.')
        freshToken()
        return false
      }
      setSubmitted(true)
      return true
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
      freshToken()
      return false
    } finally {
      setLoading(false)
    }
  }

  return {
    loading, submitted, error, clearError: () => setError(''),
    honeypot, setHoneypot, turnstileReset,
    onTurnstileVerify: setTurnstileToken, onTurnstileExpire: () => setTurnstileToken(''),
    submit,
  }
}
