'use client'

import { useState, useRef, useEffect } from 'react'
import Turnstile from '@/components/Turnstile'
import { track } from '@/lib/analytics'

const inputCls = 'input'

type Opt = { value: string; label: string }

export default function PartnersEnquiryForm({ options }: { options: readonly Opt[] }) {
  const [form, setForm] = useState({ name: '', organization: '', email: '', eventName: '', eventDate: '', eventVenue: '', budgetRange: '', eventWebsite: '', collaboration: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const loadedAt = useRef(Date.now())
  // Channel tag from the link (?src=newsletter-oct). Read once in the browser so the
  // page itself stays cacheable; only a short [a-z0-9_-] label is ever sent.
  const src = useRef('')
  useEffect(() => { try { src.current = new URLSearchParams(window.location.search).get('src') ?? '' } catch { /* optional */ } }, [])

  function set(k: keyof typeof form, v: string) {
    setForm(p => ({ ...p, [k]: v }))
    if (error) setError('')
  }

  const ready = form.name.trim() && form.organization.trim() && form.email.trim() && form.collaboration && form.message.trim().length >= 10

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || loading) return
    setError(''); setLoading(true)
    try {
      const res = await fetch('/app/api/partner-with-us/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, src: src.current, _hp: honeypot, _t: loadedAt.current, _cf: turnstileToken }),
      })
      const data = await res.json().catch(() => ({}))
      // Success only when the server says it stored the enquiry.
      if (!res.ok || data.ok !== true) {
        setError(data.error ?? 'Something went wrong. Please try again, or email us directly.')
        setTurnstileToken(''); setTurnstileReset(n => n + 1)
        return
      }
      track('partner_enquiry_submitted', { collaboration: form.collaboration })
      setSubmitted(true)
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
      setTurnstileToken(''); setTurnstileReset(n => n + 1)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div role="status" className="bg-white rounded-2xl p-8 text-center border border-gray-100">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4 text-2xl" aria-hidden="true">✓</div>
        <h3 className="text-xl font-extrabold text-gray-900 mb-2">Thanks — your enquiry is in.</h3>
        <p className="text-gray-600 text-sm">We&apos;ll reply to <strong className="text-gray-700">{form.email}</strong> after reading it. Nothing is agreed until we&apos;ve talked.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-100">
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-5">{error}</div>}
      <form onSubmit={submit} noValidate className="space-y-4">
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }}>
          <label>Website<input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" /></label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pe-name" className="block text-xs font-semibold text-gray-600 mb-1.5">Your name</label>
            <input id="pe-name" autoComplete="name" value={form.name} onChange={e => set('name', e.target.value)} required maxLength={120} className={inputCls} />
          </div>
          <div>
            <label htmlFor="pe-org" className="block text-xs font-semibold text-gray-600 mb-1.5">Organization</label>
            <input id="pe-org" autoComplete="organization" value={form.organization} onChange={e => set('organization', e.target.value)} required maxLength={160} className={inputCls} />
          </div>
        </div>
        <div>
          <label htmlFor="pe-email" className="block text-xs font-semibold text-gray-600 mb-1.5">Business email</label>
          <input id="pe-email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} required className={inputCls} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pe-event" className="block text-xs font-semibold text-gray-600 mb-1.5">Event name <span className="font-normal text-gray-500">(if applicable)</span></label>
            <input id="pe-event" value={form.eventName} onChange={e => set('eventName', e.target.value)} maxLength={160} className={inputCls} />
          </div>
          <div>
            <label htmlFor="pe-date" className="block text-xs font-semibold text-gray-600 mb-1.5">Event date <span className="font-normal text-gray-500">(optional)</span></label>
            <input id="pe-date" type="date" value={form.eventDate} onChange={e => set('eventDate', e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pe-venue" className="block text-xs font-semibold text-gray-600 mb-1.5">Venue <span className="font-normal text-gray-500">(if applicable)</span></label>
            <input id="pe-venue" value={form.eventVenue} onChange={e => set('eventVenue', e.target.value)} maxLength={160} className={inputCls} />
          </div>
          <div>
            <label htmlFor="pe-budget" className="block text-xs font-semibold text-gray-600 mb-1.5">Budget range <span className="font-normal text-gray-500">(optional)</span></label>
            <input id="pe-budget" value={form.budgetRange} onChange={e => set('budgetRange', e.target.value)} maxLength={80} placeholder="e.g. €500–1,000, or not sure yet" className={inputCls} />
          </div>
        </div>
        <div>
          <label htmlFor="pe-site" className="block text-xs font-semibold text-gray-600 mb-1.5">Website <span className="font-normal text-gray-500">(optional)</span></label>
          <input id="pe-site" type="url" inputMode="url" placeholder="https://" value={form.eventWebsite} onChange={e => set('eventWebsite', e.target.value)} maxLength={300} className={inputCls} />
        </div>
        <div>
          <label htmlFor="pe-collab" className="block text-xs font-semibold text-gray-600 mb-1.5">Partnership interest</label>
          <select id="pe-collab" value={form.collaboration} onChange={e => set('collaboration', e.target.value)} required className={`${inputCls} text-base sm:text-sm`}>
            <option value="">Choose one…</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pe-msg" className="block text-xs font-semibold text-gray-600 mb-1.5">
            Message <span className="font-normal text-gray-500">({form.message.length}/1500)</span>
          </label>
          <textarea id="pe-msg" rows={5} value={form.message} onChange={e => set('message', e.target.value.slice(0, 1500))} required
            placeholder="What is the event, who is it for, and what would you like to explore with us?" className={`${inputCls} resize-none text-base sm:text-sm`} />
        </div>

        <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} resetSignal={turnstileReset} />

        <button type="submit" disabled={loading || !ready}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors disabled:opacity-50">
          {loading ? 'Sending…' : 'Send enquiry'}
        </button>
        <p className="text-center text-xs text-gray-500">We reply by email. This does not subscribe you to anything.</p>
      </form>
    </div>
  )
}
