'use client'

import { useState, useRef } from 'react'
import Turnstile from '@/components/Turnstile'

const inputCls = 'input'

const FORMATS = [
  { value: 'event_sponsorship', label: 'Event Sponsorship'  },
  { value: 'newsletter',        label: 'Newsletter Feature' },
  { value: 'club_partnership',  label: 'Club Partnership'   },
  { value: 'branded_event',     label: 'Branded Event'      },
  { value: 'other',             label: 'Not sure yet'       },
]

export default function AdvertiseFormClient() {
  const [form, setForm] = useState({
    name: '', email: '', company: '', format: '', message: '',
  })
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')
  const [honeypot,       setHoneypot]       = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const loadedAt = useRef(Date.now())

  function set(k: keyof typeof form, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
    if (error) setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/app/api/advertise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:    form.name,
          email:   form.email,
          company: form.company,
          format:  form.format,
          message: form.message,
          _hp: honeypot,
          _t:  loadedAt.current,
          _cf: turnstileToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center border border-gray-100">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5 text-2xl">✓</div>
        <h3 className="text-xl font-extrabold text-gray-900 mb-2">Thanks for reaching out!</h3>
        <p className="text-gray-500 text-sm">
          We'll review your enquiry and get back to <strong className="text-gray-700">{form.email}</strong> within 48 hours.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-gray-50 rounded-2xl p-7 border border-gray-100">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-5">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)}
          tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Your name</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Ayşe Kaya" required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Work email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              placeholder="you@company.com" required className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Company / Brand</label>
          <input type="text" value={form.company} onChange={e => set('company', e.target.value)}
            placeholder="Your company name" required className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-2">Format of interest</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FORMATS.map(f => (
              <button key={f.value} type="button" onClick={() => set('format', f.value)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold text-center transition-colors ${
                  form.format === f.value
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-white'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">
            Tell us about your goals
            <span className="text-gray-400 font-normal ml-1">({form.message.length}/800)</span>
          </label>
          <textarea
            value={form.message} onChange={e => set('message', e.target.value.slice(0, 800))}
            placeholder="What are you trying to promote? Who are you trying to reach? Any specific events or timing in mind?"
            rows={5} required className={`${inputCls} resize-none`}
          />
        </div>

        <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />

        <button
          type="submit"
          disabled={loading || !form.name.trim() || !form.email.trim() || !form.company.trim() || !form.message.trim()}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors disabled:opacity-50">
          {loading ? 'Sending…' : 'Send enquiry'}
        </button>

        <p className="text-center text-xs text-gray-400">
          We reply within 48 hours. No commitment required.
        </p>
      </form>
    </div>
  )
}
