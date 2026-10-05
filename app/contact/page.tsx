'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Turnstile from '@/components/Turnstile'
import { useAuth } from '@/contexts/AuthContext'

// The server takes up to 3,000 characters (app/api/contact). The box used to
// stop at 1,000 and silently cut a pasted message.
const MAX_MESSAGE = 3000

const TOPICS = [
  { value: 'general',     label: 'General Inquiry',             icon: '💬' },
  { value: 'membership',  label: 'Membership & Applications',   icon: '👤' },
  { value: 'event',       label: 'Event Question',              icon: '📅' },
  { value: 'club',        label: 'Club Question',               icon: '⬡'  },
  { value: 'technical',   label: 'Technical Issue',             icon: '⚙️'  },
  { value: 'handbook',    label: 'Handbook article',            icon: '📖' },
  // The city guide's "Have a tip to share?" for members (app/guide/GuideCTA).
  { value: 'guide',       label: 'City guide tip',              icon: '🗺️', hidden: true },
  { value: 'partnership', label: 'Partnership & Collaboration', icon: '🤝' },
  { value: 'press',       label: 'Media & Press',               icon: '📰' },
  { value: 'other',       label: 'Something else',              icon: '✦'  },
  // Reached only from the remote-work hub's "Nominate them" link: it is a
  // member's errand, so it isn't offered as a chip to everyone who opens
  // the form, but stays selected (and visible) once the link set it.
  { value: 'nominate',    label: 'Nominate a remote worker',    icon: '💻', hidden: true },
  // The landing page's "Somewhere you'd like to see Smileys? Tell us where."
  // Arrived as a General Inquiry, so city demand was uncounted.
  { value: 'city',        label: 'Suggest a city',              icon: '📍', hidden: true },
  // /get-involved's host and club offers (2026-09-29).
  { value: 'host',        label: 'Offer to host',               icon: '🎤', hidden: true },
  { value: 'club-proposal', label: 'Propose a club',            icon: '⬡',  hidden: true },
]

const inputCls = 'input'

// useSearchParams needs a boundary under static rendering — the house
// pattern (see app/host/events/new).
export default function ContactPage() {
  return <Suspense><ContactForm /></Suspense>
}

function ContactForm() {
  const params = useSearchParams()
  const { user, isLoggedIn } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', topic: 'general', message: '' })
  // The city the link named, by its real name (İzmir, not "Izmir" rebuilt
  // from the slug) and shown to the sender, who otherwise never knew their
  // message was tagged with one.
  const citySlug = params.get('city')?.trim().toLowerCase() || null
  const [cityName, setCityName] = useState<string | null>(null)
  // True once the lookup has answered (or failed): the starter text waits for it.
  const [cityLooked, setCityLooked] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')
  const [honeypot,        setHoneypot]        = useState('')
  const [turnstileToken,  setTurnstileToken]  = useState('')
  // Bumped after a failed submit — Turnstile tokens are single-use, so retries need a fresh one
  const [turnstileReset,  setTurnstileReset]  = useState(0)
  const loadedAt = useRef(Date.now())

  // The Handbook's "Send a tip" and "Pitch a topic" links carry what they
  // are about; the form used to drop both and arrive as a General Inquiry
  // with no article named. Seeded once, and still fully editable.
  useEffect(() => {
    if (!citySlug) return
    let live = true
    fetch('/app/api/cities')
      .then(r => r.ok ? r.json() : null)
      .then((d: { slug: string; name: string }[] | null) => {
        if (live) setCityName(d?.find(c => c.slug === citySlug)?.name ?? null)
      })
      .catch(() => {})
      .finally(() => { if (live) setCityLooked(true) })
    return () => { live = false }
  }, [citySlug])

  // Members don't retype who they are; still editable, and only filled when empty.
  useEffect(() => {
    if (!isLoggedIn) return
    setForm(prev => ({
      ...prev,
      name:  prev.name  || (user.name && user.name !== 'Guest' ? user.name : ''),
      email: prev.email || user.email || '',
    }))
  }, [isLoggedIn, user.name, user.email])

  useEffect(() => {
    const topic   = params.get('topic')
    const article = params.get('article')
    // Starter text waits for the city's real name when the link carries one.
    if (citySlug && !cityLooked && ['nominate', 'host', 'club-proposal', 'guide'].includes(topic ?? '')) return
    const city    = cityName
    if (!topic && !article) return
    // The nomination arrives as the three things the hosts need to follow
    // it up; the slug names the city because the form itself has none.
    const nomination = topic === 'nominate'
      ? `Nominating someone for "Working from${city ? ` ${city}` : ''}":\n\nWho they are (first name, and how I know them):\n\nWhat they do and roughly how long they've been here:\n\nWhy their answers would be worth reading:\n\n`
      : null
    setForm(prev => ({
      ...prev,
      topic:   TOPICS.some(t => t.value === topic) ? topic! : prev.topic,
      message: prev.message ? prev.message
        : article    ? `About the Handbook article "${article}":\n\n`
        : nomination ?? (
          topic === 'city' ? 'I would love to see Smileys in: \n\n'
          : topic === 'host' ? `I'd like to host${city ? ` in ${city}` : ''}.\n\nWhat I'd run (and roughly how often):\n\nWhere it could happen:\n\nAnything I've hosted before:\n\n`
          : topic === 'club-proposal' ? `Club idea${city ? ` for ${city}` : ''}:\n\nWhat it's about and who it's for:\n\nHow often it would meet:\n\nWould you host it yourself?\n\n`
          : topic === 'guide' ? `A tip for the ${city ? `${city} ` : ''}guide (the place, where it is, and why you like it):\n\n`
          : prev.message),
    }))
    // Once, on arrival: after that the form is the member's.
  }, [params, citySlug, cityName, cityLooked])

  function set(k: keyof typeof form, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
    if (error) setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/app/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The city the link named, so the team knows where an offer is for.
        body: JSON.stringify({ ...form, city: citySlug ?? undefined, _hp: honeypot, _t: loadedAt.current, _cf: turnstileToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        setTurnstileToken('')
        setTurnstileReset(n => n + 1)
        return
      }
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm">

        {/* Hero */}
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
            <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-4">Contact</span>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
              Get in touch
            </h1>
            <p className="text-lg text-gray-600 max-w-xl">
              Have a question, idea, or issue? We&apos;re a small team and we read every message personally.
            </p>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

            {/* Form */}
            <div className="lg:col-span-2">
              {submitted ? (
                <div className="bg-white rounded-2xl shadow-card p-10 text-center">
                  <div aria-hidden="true" className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5 text-3xl">✓</div>
                  <h2 role="status" className="text-2xl font-extrabold text-gray-900 mb-2">Message sent!</h2>
                  <p className="text-gray-600 mb-6">
                    Thanks for reaching out. We&apos;ll reply to <strong className="text-gray-700">{form.email}</strong>.
                  </p>
                  <div className="flex gap-3 justify-center flex-wrap">
                    <button onClick={() => { setSubmitted(false); setForm(prev => ({ name: prev.name, email: prev.email, topic: 'general', message: '' })); loadedAt.current = Date.now() }}
                      className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                      Send another message
                    </button>
                    <Link href="/events"
                      className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
                      Browse events
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow-card p-7">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">Send us a message</h2>

                  {error && (
                    <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-5">
                      {error}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} noValidate className="space-y-5">
                    {/* Honeypot — hidden from real users, bots fill it */}
                    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }}>
                      <label>Website<input
                        type="text" name="website" value={honeypot}
                        onChange={e => setHoneypot(e.target.value)}
                        tabIndex={-1} autoComplete="off"
                      /></label>
                    </div>

                    {/* Topic selector */}
                    <div>
                      <p id="ct-topic-label" className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                        What&apos;s this about?
                      </p>
                      <div role="group" aria-labelledby="ct-topic-label" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {TOPICS.filter(t => !t.hidden || t.value === form.topic).map(t => (
                          <button key={t.value} type="button" aria-pressed={form.topic === t.value}
                            onClick={() => set('topic', t.value)}
                            className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-xs font-semibold transition-colors ${
                              form.topic === t.value
                                ? 'border-amber-400 bg-amber-50 text-amber-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                            }`}>
                            <span aria-hidden="true" className="text-lg">{t.icon}</span>
                            <span className="leading-tight text-center">{t.label}</span>
                          </button>
                        ))}
                      </div>
                      {cityName && (
                        <p className="mt-2 text-xs text-gray-600">This message will be tagged with <strong className="text-gray-800">{cityName}</strong>.</p>
                      )}
                    </div>

                    {/* Name + email */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="ct-name" className="block text-xs font-semibold text-gray-600 mb-1.5">Your name</label>
                        <input
                          id="ct-name"
                          type="text" value={form.name} onChange={e => set('name', e.target.value)}
                          placeholder="Ayşe Kaya" required maxLength={100} autoComplete="name" className={inputCls}
                        />
                      </div>
                      <div>
                        <label htmlFor="ct-email" className="block text-xs font-semibold text-gray-600 mb-1.5">Email address</label>
                        <input
                          id="ct-email"
                          type="email" value={form.email} onChange={e => set('email', e.target.value)}
                          placeholder="you@example.com" required maxLength={254} autoComplete="email" className={inputCls}
                        />
                      </div>
                    </div>

                    {/* Message */}
                    <div>
                      <label htmlFor="ct-message" className="block text-xs font-semibold text-gray-600 mb-1.5">
                        Message
                        <span className={`font-normal ml-1 ${form.message.length > MAX_MESSAGE ? 'text-red-600' : 'text-gray-500'}`}>({form.message.length.toLocaleString('en-US')}/{MAX_MESSAGE.toLocaleString('en-US')})</span>
                      </label>
                      {/* Never cut what someone pasted: over the limit shows in
                          red and holds the button until it's shortened. */}
                      <textarea
                        id="ct-message"
                        aria-describedby="ct-message-limit"
                        value={form.message} onChange={e => set('message', e.target.value)}
                        placeholder="Tell us what's on your mind…"
                        rows={6} required
                        className={`${inputCls} resize-none`}
                      />
                      {form.message.length > MAX_MESSAGE && (
                        <p id="ct-message-limit" role="alert" className="mt-1 text-xs text-red-600">
                          That&apos;s {(form.message.length - MAX_MESSAGE).toLocaleString('en-US')} characters over the limit. Please shorten it a little.
                        </p>
                      )}
                    </div>

                    <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} resetSignal={turnstileReset} />

                    <button
                      type="submit"
                      disabled={loading || !form.name.trim() || !form.email.trim() || !form.message.trim() || form.message.length > MAX_MESSAGE}
                      className="btn-primary w-full text-sm"
                    >
                      {loading ? 'Sending…' : 'Send message'}
                    </button>

                    <p className="text-xs text-gray-500">
                      We reply by email.
                    </p>
                  </form>
                </div>
              )}
            </div>

            {/* Sidebar — contact info */}
            <div className="space-y-5">

              {/* Direct contact */}
              <div className="bg-white rounded-2xl shadow-card p-6">
                <h3 className="font-bold text-gray-900 mb-4">Other ways to reach us</h3>
                <div className="space-y-4">
                  <a href="https://www.instagram.com/smileys.community" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 text-sm text-gray-600 hover:text-pink-600 transition-colors group">
                    <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center justify-center group-hover:bg-pink-100 transition-colors shrink-0">
                      <svg aria-hidden="true" className="w-4 h-4 text-pink-500" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                      </svg>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-xs mb-0.5">Instagram</div>
                      <div>@smileys.community</div>
                    </div>
                  </a>
                </div>
              </div>

              {/* How we reply — no response time nobody measures (the FAQ and
                  Why pages dropped theirs too), and no "DM us for urgent". */}
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6">
                <h3 className="font-bold text-gray-900 mb-2">How we reply</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Every message reaches the team&apos;s inbox, and we reply by email to the address you give.
                </p>
              </div>

              {/* Join CTA — for people who aren't members yet */}
              {!isLoggedIn && (
                <div className="bg-gray-900 rounded-2xl p-6 text-white">
                  <h3 className="font-bold mb-2">Not a member yet?</h3>
                  <p className="text-sm text-gray-300 mb-4">
                    Meet people through hosted events and clubs{cityName ? ` in ${cityName}` : ''}. Applying is free.
                  </p>
                  <Link href={citySlug ? `/apply?city=${encodeURIComponent(citySlug)}` : '/apply'}
                    className="block text-center py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
                    Apply to join
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  )
}
