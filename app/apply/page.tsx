'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Turnstile from '@/components/Turnstile'
import { z } from 'zod'
import { resolveImageUrl } from '@/lib/data'
import { COUNTRIES } from '@/lib/countries'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import FingerprintJS from '@fingerprintjs/fingerprintjs'

const step0Schema = z.object({
  firstName:    z.string().min(1, 'First name is required'),
  lastName:     z.string().min(1, 'Last name is required'),
  email:        z.string().min(1, 'Email is required').email('Enter a valid email address'),
  phone:        z.string().min(6, 'Phone number is required'),
  country:      z.string().min(1, 'Country is required'),
  neighborhood: z.string().min(2, 'Neighborhood is required'),
})

type FieldErrors = Partial<Record<keyof z.infer<typeof step0Schema>, string>>

function fieldCls(error?: string) {
  return error ? 'input input-error' : 'input'
}

const inputCls = 'input'

const STEPS = [
  'Basic Info',
  'About You',
  'Community Fit',
  'Interests',
  'Contribution',
  'Verification',
]

const SOCIAL_STYLES = [
  { id: 'deep_talker',      label: '🗣️ Deep Talker',      desc: 'Loves meaningful 1:1 conversations' },
  { id: 'social_butterfly', label: '🎉 Social Butterfly',  desc: 'Energized by big groups' },
  { id: 'connector',        label: '🤝 Connector',         desc: 'Loves introducing people to each other' },
  { id: 'initiator',        label: '🔥 Initiator',         desc: 'Always the one to break the ice' },
  { id: 'laid_back',        label: '🧘 Laid-back',         desc: 'Goes with the flow, no agenda' },
  { id: 'new_in_town',      label: '🌱 New in Town',       desc: 'Fresh arrival still exploring' },
  { id: 'small_groups',     label: '☕ Small Groups',      desc: 'Prefers intimate settings' },
  { id: 'up_for_anything',  label: '🎭 Up for Anything',   desc: 'Spontaneous and adventurous' },
]

const INTERESTS_LIST = [
  { value: 'sailing',    label: 'Sailing',               emoji: '⛵' },
  { value: 'dining',     label: 'Dining',                emoji: '🍽️' },
  { value: 'social',     label: 'Social / Parties',      emoji: '🎉' },
  { value: 'wellness',   label: 'Wellness',              emoji: '🧘' },
  { value: 'networking', label: 'Networking / Business',  emoji: '🧠' },
  { value: 'languages',  label: 'Language Exchange',     emoji: '🌍' },
  { value: 'games',      label: 'Games / Trivia',        emoji: '🎲' },
  { value: 'outdoor',    label: 'Outdoor Activities',    emoji: '🚶' },
]

export default function ApplyPage() {
  return (
    <Suspense>
      <ApplyForm />
    </Suspense>
  )
}

function ApplyForm() {
  const searchParams = useSearchParams()
  const refCode = searchParams.get('ref') ?? ''

  const [honeypot,       setHoneypot]       = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [fingerprint,    setFingerprint]    = useState('')
  const [browserTz,      setBrowserTz]      = useState('')

  useEffect(() => {
    FingerprintJS.load().then(fp => fp.get()).then(result => setFingerprint(result.visitorId)).catch(() => {})
    try { setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone) } catch {}
  }, [])
  const [step,    setStep]    = useState(0)
  const [form,    setForm]    = useState({
    firstName: '', lastName: '', email: '', phone: '', birthdate: '', gender: '',
    country: '', neighborhood: '',
    instagram: '', linkedin: '',
    profession: '', timeInCity: '', reasonHere: '', bio: '', source: '',
    whyJoin: '', enjoyWith: '', goodCommunity: '',
    contribution: '',
    groupBehavior: '', removedFromCommunity: '', toxicBehavior: '',
    profilePhoto: '',
  })
  const [interests,      setInterests]      = useState<string[]>([])
  const [socialStyles,   setSocialStyles]   = useState<string[]>([])
  const [agreements,     setAgreements]     = useState({ a1: false, a2: false, a3: false })
  const [saving,         setSaving]         = useState(false)
  const [submitted,      setSubmitted]      = useState(false)
  const [fieldErrors,    setFieldErrors]    = useState<FieldErrors>({})
  const [submitError,    setSubmitError]    = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [localPhoto,     setLocalPhoto]     = useState('')
  const photoInputRef  = useRef<HTMLInputElement>(null)
  const errorRef       = useRef<HTMLDivElement>(null)

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    // Clear field error as soon as user types
    if (key in step0Schema.shape) {
      setFieldErrors(e => { const n = { ...e }; delete n[key as keyof FieldErrors]; return n })
    }
  }

  function validateField(key: keyof FieldErrors, value: string) {
    const result = step0Schema.shape[key].safeParse(value)
    setFieldErrors(e => ({
      ...e,
      [key]: result.success ? undefined : result.error.issues[0].message,
    }))
  }

  async function handlePhotoUpload(file: File) {
    // Show local preview immediately
    const localUrl = URL.createObjectURL(file)
    setLocalPhoto(localUrl)

    setPhotoUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res  = await fetch('/app/api/apply/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.url) set('profilePhoto', data.url)
      else setSubmitError(data.error ?? 'Photo upload failed')
    } catch {
      setSubmitError('Photo upload failed')
    } finally {
      setPhotoUploading(false)
    }
  }

  function validateStep(): boolean {
    if (step === 0) {
      const result = step0Schema.safeParse(form)
      if (!result.success) {
        const errs: FieldErrors = {}
        result.error.issues.forEach(i => {
          const key = i.path[0] as keyof FieldErrors
          if (!errs[key]) errs[key] = i.message
        })
        setFieldErrors(errs)
        return false
      }
      setFieldErrors({})
    }
    if (step === 5) {
      if (!form.profilePhoto) { setSubmitError('Please upload a profile photo'); return false }
      if (!agreements.a1 || !agreements.a2 || !agreements.a3) { setSubmitError('Please agree to all terms'); return false }
    }
    return true
  }

  function next() {
    if (!validateStep()) return
    setSubmitError('')
    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function back() {
    setSubmitError('')
    setFieldErrors({})
    setStep(s => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function showError(msg: string) {
    setSubmitError(msg)
    setTimeout(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  async function handleSubmit() {
    if (!validateStep()) return
    if (!turnstileToken) {
      showError('Please complete the human verification above before submitting.')
      return
    }
    setSaving(true)
    setSubmitError('')
    try {
      const res  = await fetch('/app/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, interests, socialStyles, referredBy: refCode || undefined, _hp: honeypot, _cf: turnstileToken, _fp: fingerprint, _tz: browserTz }),
      })
      const data = await res.json()
      if (!res.ok) { showError(data.error ?? 'Failed to submit'); return }
      setSubmitted(true)
    } catch {
      showError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-warm flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-card p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="text-4xl mb-3">😊</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">You're under review!</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-2">
            Thanks for applying to Smileys Community. We personally review every application.
          </p>
          <p className="text-gray-500 text-sm mb-6">
            We'll get back to you at <strong>{form.email}</strong> within 2–3 days.
          </p>
          <Link href="/" className="text-amber-600 font-semibold text-sm hover:underline">← Back to home</Link>
        </div>
      </div>
    )
  }

  const progress = Math.round((step / (STEPS.length - 1)) * 100)

  return (
    <div className="min-h-screen bg-warm">
      <div className="max-w-lg mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-6">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Application</span>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-1">Apply to join</h1>
          <p className="text-gray-500 text-sm">Smileys is a curated community in Istanbul.</p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500">Step {step + 1} of {STEPS.length}</span>
            <span className="text-xs font-semibold text-amber-600">{STEPS[step]}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map((s, i) => (
              <div key={s} className={`w-2 h-2 rounded-full transition-colors ${i <= step ? 'bg-amber-500' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>

        {/* Social proof — only on first step */}
        {step === 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-6 space-y-2">
            {[
              { icon: '🤝', text: 'Members who made their closest friends here' },
              { icon: '🌍', text: 'Expats who found their Istanbul community' },
              { icon: '💼', text: 'Founders who met their co-founders at events' },
            ].map(s => (
              <div key={s.text} className="flex items-center gap-2.5">
                <span className="text-base shrink-0">{s.icon}</span>
                <span className="text-xs text-amber-800 font-medium">{s.text}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-amber-200 mt-1">
              <Link href="/why" className="text-xs font-bold text-amber-600 hover:underline">Read member stories →</Link>
            </div>
          </div>
        )}

        {submitError && (
          <div ref={errorRef} className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium mb-4">
            {submitError}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-card p-6 space-y-4">
          <input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)}
            tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }} />

          {/* Step 1: Basic Info */}
          {step === 0 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">Basic Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">First name *</label>
                <input type="text" value={form.firstName}
                  onChange={e => set('firstName', e.target.value)}
                  onBlur={e => validateField('firstName', e.target.value)}
                  placeholder="Ayşe" className={fieldCls(fieldErrors.firstName)} />
                {fieldErrors.firstName && <p className="text-xs text-red-500 mt-1">{fieldErrors.firstName}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">Last name *</label>
                <input type="text" value={form.lastName}
                  onChange={e => set('lastName', e.target.value)}
                  onBlur={e => validateField('lastName', e.target.value)}
                  placeholder="Kaya" className={fieldCls(fieldErrors.lastName)} />
                {fieldErrors.lastName && <p className="text-xs text-red-500 mt-1">{fieldErrors.lastName}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">Date of birth</label>
                <input type="date" value={form.birthdate} onChange={e => set('birthdate', e.target.value)}
                  max={new Date().toISOString().split('T')[0]} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">Country *</label>
                <select value={form.country}
                  onChange={e => set('country', e.target.value)}
                  onBlur={e => validateField('country', e.target.value)}
                  className={`${fieldCls(fieldErrors.country)} bg-white`}>
                  <option value="">Select country…</option>
                  {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
                </select>
                {fieldErrors.country && <p className="text-xs text-red-500 mt-1">{fieldErrors.country}</p>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Gender</label>
              <select value={form.gender} onChange={e => set('gender', e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">Select…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non_binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Neighborhood / Area *</label>
              <select value={form.neighborhood}
                onChange={e => { set('neighborhood', e.target.value); validateField('neighborhood', e.target.value) }}
                className={fieldCls(fieldErrors.neighborhood)}>
                <option value="">Select your neighborhood…</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              {fieldErrors.neighborhood && <p className="text-xs text-red-500 mt-1">{fieldErrors.neighborhood}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Phone (WhatsApp) *</label>
              <input type="tel" value={form.phone}
                onChange={e => set('phone', e.target.value)}
                onBlur={e => validateField('phone', e.target.value)}
                placeholder="+90 555 000 0000" className={fieldCls(fieldErrors.phone)} />
              {fieldErrors.phone && <p className="text-xs text-red-500 mt-1">{fieldErrors.phone}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Email *</label>
              <input type="email" value={form.email}
                onChange={e => set('email', e.target.value)}
                onBlur={e => validateField('email', e.target.value)}
                placeholder="you@example.com" className={fieldCls(fieldErrors.email)} />
              {fieldErrors.email && <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">Instagram</label>
                <input type="text" value={form.instagram} onChange={e => set('instagram', e.target.value)}
                  placeholder="@handle" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">LinkedIn</label>
                <input type="text" value={form.linkedin} onChange={e => set('linkedin', e.target.value)}
                  placeholder="linkedin.com/in/…" className={inputCls} />
              </div>
            </div>
          </>}

          {/* Step 2: About You */}
          {step === 1 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">About You</h2>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">What do you do professionally?</label>
              <input type="text" value={form.profession} onChange={e => set('profession', e.target.value)}
                placeholder="e.g. Product designer, entrepreneur…" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">How long have you been in Istanbul?</label>
              <input type="text" value={form.timeInCity} onChange={e => set('timeInCity', e.target.value)}
                placeholder="e.g. 3 years, just arrived…" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">What brings you here?</label>
              <input type="text" value={form.reasonHere} onChange={e => set('reasonHere', e.target.value)}
                placeholder="e.g. Work, relocated, digital nomad…" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Anything else you'd like us to know?</label>
              <textarea rows={3} value={form.bio} onChange={e => set('bio', e.target.value)}
                placeholder="What you're passionate about, looking for…"
                className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">How did you hear about us?</label>
              <select value={form.source} onChange={e => set('source', e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">Select…</option>
                <option value="instagram">Instagram</option>
                <option value="friend">Friend / referral</option>
                <option value="google">Google</option>
                <option value="event">Attended an event</option>
                <option value="other">Other</option>
              </select>
            </div>
          </>}

          {/* Step 3: Community Fit */}
          {step === 2 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">Community Fit</h2>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Why do you want to join Smileys?</label>
              <textarea rows={3} value={form.whyJoin} onChange={e => set('whyJoin', e.target.value)}
                placeholder="What draws you to Smileys specifically…"
                className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">What kind of people do you enjoy spending time with?</label>
              <textarea rows={3} value={form.enjoyWith} onChange={e => set('enjoyWith', e.target.value)}
                placeholder="Describe your ideal social circle…"
                className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">What does a "good community" mean to you?</label>
              <textarea rows={3} value={form.goodCommunity} onChange={e => set('goodCommunity', e.target.value)}
                placeholder="What makes a community worth being part of…"
                className={`${inputCls} resize-none`} />
            </div>
          </>}

          {/* Step 4: Interests + Social Style */}
          {step === 3 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">Interests & Activities</h2>
            <p className="text-xs text-gray-400">Select everything that interests you</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {INTERESTS_LIST.map(item => {
                const active = interests.includes(item.value)
                return (
                  <button key={item.value} type="button"
                    onClick={() => setInterests(prev =>
                      prev.includes(item.value) ? prev.filter(i => i !== item.value) : [...prev, item.value]
                    )}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                      active ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-lg">{item.emoji}</span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="pt-2">
              <h3 className="font-bold text-gray-900 text-sm mb-1">Social Style <span className="font-normal text-gray-400">(optional)</span></h3>
              <p className="text-xs text-gray-400 mb-2">How do you show up socially? Pick up to 3.</p>
              <div className="flex flex-wrap gap-2">
                {SOCIAL_STYLES.map(s => {
                  const active = socialStyles.includes(s.id)
                  return (
                    <button key={s.id} type="button"
                      title={s.desc}
                      onClick={() => setSocialStyles(prev =>
                        active ? prev.filter(x => x !== s.id)
                               : prev.length < 3 ? [...prev, s.id] : prev
                      )}
                      className={`text-sm px-3 py-2 rounded-full font-medium transition-colors border-2 ${
                        active
                          ? 'bg-amber-50 border-amber-400 text-amber-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </>}

          {/* Step 5: Contribution & Social Behavior */}
          {step === 4 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">Contribution Mindset</h2>
            <p className="text-xs text-gray-400 mb-2">What role do you see yourself playing?</p>
            <div className="space-y-2">
              {[
                { value: 'attend',   label: 'Attend events only',        emoji: '🎟️' },
                { value: 'organize', label: 'Help organize events',       emoji: '🤝' },
                { value: 'host',     label: 'Become a host in the future', emoji: '🎖️' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => set('contribution', opt.value)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                    form.contribution === opt.value ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="text-xl">{opt.emoji}</span>
                  <span>{opt.label}</span>
                  {form.contribution === opt.value && <span className="ml-auto text-amber-500">✓</span>}
                </button>
              ))}
            </div>

            <div className="pt-2">
              <h3 className="font-bold text-gray-900 text-sm mb-3">Social Behavior</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-2">How do you usually behave in group settings?</label>
                  <textarea rows={2} value={form.groupBehavior} onChange={e => set('groupBehavior', e.target.value)}
                    placeholder="e.g. I'm usually the one who brings people together…"
                    className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-2">Have you ever been removed from a community? <span className="font-normal text-gray-400">(If yes, why?)</span></label>
                  <textarea rows={2} value={form.removedFromCommunity} onChange={e => set('removedFromCommunity', e.target.value)}
                    placeholder="No / Yes — briefly explain…"
                    className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-2">What would you do if you see toxic behavior in a group?</label>
                  <textarea rows={2} value={form.toxicBehavior} onChange={e => set('toxicBehavior', e.target.value)}
                    placeholder="e.g. I would address it directly, speak to the organizer…"
                    className={`${inputCls} resize-none`} />
                </div>
              </div>
            </div>
          </>}

          {/* Step 6: Verification & Agreement */}
          {step === 5 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">Verification</h2>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Profile photo <span className="text-red-400">*</span></label>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} />
              {localPhoto || form.profilePhoto ? (
                <div className="flex items-center gap-4">
                  <img src={localPhoto || resolveImageUrl(form.profilePhoto)} alt="Profile" className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-200" />
                  <button type="button" onClick={() => photoInputRef.current?.click()}
                    className="text-sm text-amber-600 hover:underline font-medium">Change photo</button>
                </div>
              ) : (
                <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}
                  className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 flex flex-col items-center gap-2 hover:border-amber-400 transition-colors disabled:opacity-50">
                  {photoUploading ? <span className="text-sm text-gray-400">Uploading…</span> : <>
                    <span className="text-3xl">📸</span>
                    <span className="text-sm font-medium text-gray-600">Click to upload a clear photo</span>
                    <span className="text-xs text-gray-400">JPG or PNG, max 4MB</span>
                  </>}
                </button>
              )}
            </div>

            <div className="pt-2 space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">Agreement</h3>
              {[
                { key: 'a1' as const, text: 'I understand Smileys is a curated community and membership can be revoked.' },
                { key: 'a2' as const, text: 'I agree to respectful behavior and active participation in the community.' },
                { key: 'a3' as const, text: 'I understand that inactive or negative members may be removed.' },
              ].map(({ key, text }) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer group">
                  <div className={`mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors ${
                    agreements[key] ? 'bg-amber-500 border-amber-500' : 'border-gray-300 group-hover:border-amber-400'
                  }`} onClick={() => setAgreements(a => ({ ...a, [key]: !a[key] }))}>
                    {agreements[key] && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>}
                  </div>
                  <span className="text-sm text-gray-700 leading-relaxed">{text}</span>
                </label>
              ))}
            </div>
          </>}
        </div>

        {/* Turnstile — shown above buttons on last step */}
        {step === STEPS.length - 1 && (
          <div className="mt-5">
            <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-3">
          {step > 0 && (
            <button onClick={back}
              className="flex-1 py-3.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm">
              ← Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button onClick={next}
              className="flex-1 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors text-sm">
              Continue →
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="flex-1 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl disabled:opacity-50 transition-colors text-sm">
              {saving ? 'Submitting…' : 'Submit application →'}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4">
          Already a member?{' '}
          <Link href="/login" className="text-amber-600 font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

