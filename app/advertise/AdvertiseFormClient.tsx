'use client'

import { useState } from 'react'
import Turnstile from '@/components/Turnstile'
import { useEnquirySubmit } from '@/components/enquiry/useEnquirySubmit'

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
    name: '', email: '', company: '', website: '', format: '', targetDate: '', budgetRange: '', message: '',
  })
  const { loading, submitted, error, clearError, honeypot, setHoneypot, turnstileReset, onTurnstileVerify, onTurnstileExpire, submit } = useEnquirySubmit('/app/api/advertise')

  function set(k: keyof typeof form, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
    if (error) clearError()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit(form)
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5 text-2xl">✓</div>
        <h3 className="text-xl font-extrabold text-gray-900 mb-2">Thanks for reaching out!</h3>
        <p className="text-gray-600 text-sm">
          We&apos;ll read your inquiry and reply to <strong className="text-gray-700">{form.email}</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-100">
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-5">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }}>
          <label>Website<input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)}
            tabIndex={-1} autoComplete="off" /></label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ad-name" className="block text-xs font-semibold text-gray-600 mb-1.5">Your name</label>
            <input id="ad-name" autoComplete="name" type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Ayşe Kaya" required className={inputCls} />
          </div>
          <div>
            <label htmlFor="ad-email" className="block text-xs font-semibold text-gray-600 mb-1.5">Work email</label>
            <input id="ad-email" autoComplete="email" type="email" value={form.email} onChange={e => set('email', e.target.value)}
              placeholder="you@company.com" required className={inputCls} />
          </div>
        </div>

        <div>
          <label htmlFor="ad-company" className="block text-xs font-semibold text-gray-600 mb-1.5">Company / Brand</label>
          <input id="ad-company" autoComplete="organization" type="text" value={form.company} onChange={e => set('company', e.target.value)}
            placeholder="Your company name" required className={inputCls} />
        </div>

        <div>
          <label htmlFor="ad-website" className="block text-xs font-semibold text-gray-600 mb-1.5">Company website <span className="font-normal text-gray-500">(optional)</span></label>
          <input id="ad-website" type="url" inputMode="url" autoComplete="url" placeholder="https://" maxLength={300}
            value={form.website} onChange={e => set('website', e.target.value)} className={inputCls} />
        </div>

        <div>
          <p id="ad-format-label" className="block text-xs font-semibold text-gray-600 mb-2">Format of interest</p>
          <div role="group" aria-labelledby="ad-format-label" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FORMATS.map(f => (
              <button key={f.value} type="button" onClick={() => set('format', f.value)} aria-pressed={form.format === f.value}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold text-center transition-colors ${
                  form.format === f.value
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-white'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ad-date" className="block text-xs font-semibold text-gray-600 mb-1.5">Target start date <span className="font-normal text-gray-500">(optional)</span></label>
            <input id="ad-date" type="date" value={form.targetDate} onChange={e => set('targetDate', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ad-budget" className="block text-xs font-semibold text-gray-600 mb-1.5">Budget range <span className="font-normal text-gray-500">(optional)</span></label>
            <input id="ad-budget" maxLength={80} placeholder="e.g. €500–1,000, or not sure yet"
              value={form.budgetRange} onChange={e => set('budgetRange', e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label htmlFor="ad-message" className="block text-xs font-semibold text-gray-600 mb-1.5">
            Tell us about your goals
            <span className="text-gray-500 font-normal ml-1">({form.message.length}/1500)</span>
          </label>
          <textarea
            id="ad-message"
            value={form.message} onChange={e => set('message', e.target.value.slice(0, 1500))}
            placeholder="What are you trying to promote? Who are you trying to reach? Any specific events or timing in mind?"
            rows={5} required className={`${inputCls} resize-none`}
          />
        </div>

        <Turnstile onVerify={onTurnstileVerify} onExpire={onTurnstileExpire} resetSignal={turnstileReset} />

        <button
          type="submit"
          disabled={loading || !form.name.trim() || !form.email.trim() || !form.company.trim() || !form.message.trim()}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors disabled:opacity-50">
          {loading ? 'Sending…' : 'Send inquiry'}
        </button>

        <p className="text-center text-xs text-gray-500">
          We reply by email. No commitment required.
        </p>
      </form>
    </div>
  )
}
