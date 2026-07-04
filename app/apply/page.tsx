'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Turnstile from '@/components/Turnstile'
import { z } from 'zod'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { COUNTRIES } from '@/lib/countries'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import FingerprintJS from '@fingerprintjs/fingerprintjs'
import posthog from 'posthog-js'
import { downscaleImage, ImageUploadError } from '@/lib/image-resize'

const step0Schema = z.object({
  firstName:    z.string().min(1, 'First name is required'),
  lastName:     z.string().min(1, 'Last name is required'),
  email:        z.string().min(1, 'Email is required').email('Enter a valid email address'),
  phone:        z.string().min(6, 'Phone number is required'),
  country:      z.string().min(1, 'Country is required'),
  neighborhood: z.string().min(2, 'Neighborhood is required'),
  gender:       z.string().min(1, 'Gender is required'),
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
  'Verification', // also covers Contribution + Social Judgment after the merge
]

// Rough time-left estimate shown next to the step label — calibrated for
// "specific beats long" answers, not deep essays.
const STEP_MINUTES_LEFT = [6, 5, 3, 2, 1]
const DRAFT_KEY = 'smileys_apply_draft_v1'

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

// Common languages on apply — matches the list shown in /profile edit.
// (Could be hoisted to lib/data later if anywhere else needs it.)
const COMMON_LANGUAGES = [
  'English', 'Turkish', 'Arabic', 'Russian', 'German', 'French',
  'Spanish', 'Italian', 'Persian', 'Portuguese', 'Chinese', 'Japanese',
  'Korean', 'Hindi', 'Ukrainian', 'Dutch', 'Greek', 'Hebrew',
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
  // Bumped after a failed submit — Turnstile tokens are single-use, so retries need a fresh one
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [fingerprint,    setFingerprint]    = useState('')
  const [browserTz,      setBrowserTz]      = useState('')

  // Referral context — drives the apply-form social proof. `inviter`
  // populated when ?ref=XYZ resolves to a real approved member;
  // `totalActiveInviters` is the always-on aggregate so applicants
  // without a ref code still see the loop is real.
  const [referralCtx, setReferralCtx] = useState<{
    inviter:             { firstName: string; color: string; profilePhoto: string | null } | null
    totalActiveInviters: number
  } | null>(null)

  // Available cities for the target-city selector. Populated from
  // /api/cities; defaults to Istanbul-only on first load so the form
  // is usable while the fetch is in flight.
  const [cities,         setCities]         = useState<{ slug: string; name: string; status: string }[]>([{ slug: 'istanbul', name: 'Istanbul', status: 'live' }])
  const [targetCitySlug, setTargetCitySlug] = useState('istanbul')

  useEffect(() => {
    FingerprintJS.load().then(fp => fp.get()).then(result => setFingerprint(result.visitorId)).catch(() => {})
    try { setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone) } catch {}
  }, [])

  // Fetch the referral context once on mount. Public endpoint, no
  // session needed; query string carries the ref code so a stale URL
  // re-fetches naturally if the applicant arrives back later via a
  // different link.
  useEffect(() => {
    const qs = refCode ? `?ref=${encodeURIComponent(refCode)}` : ''
    fetch(`/app/api/apply/referral-context${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setReferralCtx(d) })
      .catch(() => {})
  }, [refCode])

  // Fetch the open cities so the form can route the application into
  // the right review queue. With only Istanbul live today the dropdown
  // hides entirely; once a second city goes live the selector appears.
  useEffect(() => {
    fetch('/app/api/cities')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d) && d.length > 0) setCities(d) })
      .catch(() => {})
  }, [])

  // Track whether the draft restore has run so the save-on-change effect
  // doesn't fire before we've loaded (which would overwrite the saved draft).
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [step,    setStep]    = useState(0)
  const [form,    setForm]    = useState({
    firstName: '', lastName: '', email: '', phone: '', birthdate: '', gender: '',
    country: '', neighborhood: '',
    profession: '', timeInCity: '', reasonHere: '', bio: '', source: '',
    // One consolidated essay (replaces whyJoin + enjoyWith + goodCommunity)
    aboutCommunity: '',
    contribution: '',
    // One judgment prompt (replaces groupBehavior + removedFromCommunity + toxicBehavior)
    socialJudgment: '',
    profilePhoto: '',
    // Open-to flags collected at apply time so new members are discoverable
    // on day 1 (copied to User on registration via approved application).
    openToCoffee:   false,
    openToLanguage: false,
    openToHosting:  false,
  })
  const [languages, setLanguages] = useState<string[]>([])
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

  // Restore any in-progress draft on first mount. Errors (private window,
  // corrupt JSON) silently fall back to the empty form — never block the user
  // from applying.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        if (d.form)         setForm(f => ({ ...f, ...d.form }))
        if (d.interests)    setInterests(d.interests)
        if (d.socialStyles) setSocialStyles(d.socialStyles)
        if (d.languages)    setLanguages(d.languages)
        if (typeof d.step === 'number') setStep(d.step)
      }
    } catch {}
    setDraftHydrated(true)
  }, [])

  // Save draft on any change once hydration is done. Skip the agreements +
  // photo upload state — those should be re-confirmed each session.
  useEffect(() => {
    if (!draftHydrated) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        form, interests, socialStyles, languages, step,
      }))
    } catch {}
  }, [draftHydrated, form, interests, socialStyles, languages, step])

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
    try {
      // Downscale before upload — iPhone HEIC/JPEG photos routinely
      // exceed the 10 MB Next.js body limit and used to fail silently
      // with "Failed to parse body as FormData". Cap the long edge at
      // 1080px and re-encode as JPEG@0.85 — plenty for a profile shot.
      const uploadFile = await downscaleImage(file, 1080, 0.85)
      const fd = new FormData()
      fd.append('file', uploadFile, 'profile.jpg')
      const res  = await fetch('/app/api/apply/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.url) set('profilePhoto', data.url)
      else setSubmitError(data.error ?? 'Photo upload failed')
    } catch (e) {
      // ImageUploadError carries a user-facing, actionable message
      // (0-byte iCloud photo, unconvertible oversized file) — show it
      // verbatim instead of the generic fallback.
      setSubmitError(e instanceof ImageUploadError ? e.message : 'Photo upload failed')
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
    if (step === STEPS.length - 1) {
      if (!form.profilePhoto) { setSubmitError('Please upload a real photo of yourself — it\'s required for review'); return false }
      if (!agreements.a1 || !agreements.a2 || !agreements.a3) { setSubmitError('Please agree to all terms'); return false }
    }
    return true
  }

  function next() {
    if (!validateStep()) return
    setSubmitError('')
    posthog.capture('application_step_completed', {
      step_index: step,
      step_name:  STEPS[step],
    })
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
        body: JSON.stringify({ ...form, interests, socialStyles, languages, referredBy: refCode || undefined, targetCitySlug, _hp: honeypot, _cf: turnstileToken, _fp: fingerprint, _tz: browserTz }),
      })
      const data = await res.json()
      if (!res.ok) {
        showError(data.error ?? 'Failed to submit')
        setTurnstileToken('')
        setTurnstileReset(n => n + 1)
        return
      }
      posthog.capture('application_submitted', {
        source:      form.source,
        interests:   interests,
        has_referral: !!refCode,
        neighborhood: form.neighborhood,
        country:     form.country,
      })
      setSubmitted(true)
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
    } catch {
      showError('Something went wrong. Please try again.')
      setTurnstileToken('')
      setTurnstileReset(n => n + 1)
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
          <p className="text-gray-600 text-sm leading-relaxed mb-2">
            Thanks for applying to Smileys Community. We personally review every application.
          </p>
          <p className="text-gray-600 text-sm mb-6">
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
          <p className="text-gray-600 text-sm">Smileys is a curated community in Istanbul.</p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600">
              Step {step + 1} of {STEPS.length}
              <span className="text-gray-400 font-normal"> · about {STEP_MINUTES_LEFT[step] ?? 1} min left</span>
            </span>
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

        {/* City selector — hidden while only Istanbul is live. Once a
            second city opens for applications the selector appears
            automatically at the top of step 0 so applicants route
            their essay into the right city's review queue. */}
        {step === 0 && cities.length > 1 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-3.5 mb-3">
            <label htmlFor="target-city" className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">
              Which city are you applying to?
            </label>
            <select
              id="target-city"
              value={targetCitySlug}
              onChange={e => setTargetCitySlug(e.target.value)}
              className="input bg-white"
            >
              {cities.map(c => (
                <option key={c.slug} value={c.slug}>
                  {c.name}{c.status === 'launching' ? ' ✦ Launching' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1.5">Pick the city you'll attend events in. Each city has its own admin team and rhythm.</p>
          </div>
        )}

        {/* Referral chip — only when ?ref=XYZ resolved to a real
            approved member. Personalised "Sarah invited you" with a
            face beats any aggregate stat for conversion, so it sits
            above the generic social-proof block on step 0. */}
        {step === 0 && referralCtx?.inviter && (
          <div className="bg-amber-100 border border-amber-200 rounded-2xl p-3.5 mb-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: referralCtx.inviter.color }}>
              {referralCtx.inviter.profilePhoto
                ? <img src={referralCtx.inviter.profilePhoto.startsWith('http') ? referralCtx.inviter.profilePhoto : `/app${referralCtx.inviter.profilePhoto}`} alt="" className="w-full h-full object-cover" />
                : referralCtx.inviter.firstName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-900"><span className="text-amber-700">{referralCtx.inviter.firstName}</span> invited you to apply 👋</p>
              <p className="text-xs text-amber-800 mt-0.5">Their referral is a positive signal in your review.</p>
            </div>
          </div>
        )}

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
            {/* Always-on referral aggregate — masks the empty state by
                only rendering once the count clears a meaningful floor.
                Tucked into the existing block so it reads as one panel
                rather than two stacked cards. */}
            {(referralCtx?.totalActiveInviters ?? 0) >= 5 && (
              <div className="flex items-center gap-2.5 pt-2 border-t border-amber-200">
                <span className="text-base shrink-0">💌</span>
                <span className="text-xs text-amber-800 font-medium">
                  Invited by <span className="font-bold text-amber-900">{referralCtx?.totalActiveInviters} members</span> who've brought friends in
                </span>
              </div>
            )}
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
                <label htmlFor="ap-firstname" className="block text-xs font-semibold text-gray-600 mb-2">First name *</label>
                <input id="ap-firstname" type="text" value={form.firstName}
                  onChange={e => set('firstName', e.target.value)}
                  onBlur={e => validateField('firstName', e.target.value)}
                  autoComplete="given-name"
                  placeholder="Ayşe" className={fieldCls(fieldErrors.firstName)} />
                {fieldErrors.firstName && <p className="text-xs text-red-500 mt-1">{fieldErrors.firstName}</p>}
              </div>
              <div>
                <label htmlFor="ap-lastname" className="block text-xs font-semibold text-gray-600 mb-2">Last name *</label>
                <input id="ap-lastname" type="text" value={form.lastName}
                  onChange={e => set('lastName', e.target.value)}
                  onBlur={e => validateField('lastName', e.target.value)}
                  autoComplete="family-name"
                  placeholder="Kaya" className={fieldCls(fieldErrors.lastName)} />
                {fieldErrors.lastName && <p className="text-xs text-red-500 mt-1">{fieldErrors.lastName}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ap-birthdate" className="block text-xs font-semibold text-gray-600 mb-2">Date of birth</label>
                <input id="ap-birthdate" type="date" value={form.birthdate} onChange={e => set('birthdate', e.target.value)}
                  autoComplete="bday"
                  max={new Date().toISOString().split('T')[0]} className={inputCls} />
              </div>
              <div>
                <label htmlFor="ap-country" className="block text-xs font-semibold text-gray-600 mb-2">Country *</label>
                <select id="ap-country" value={form.country}
                  onChange={e => set('country', e.target.value)}
                  onBlur={e => validateField('country', e.target.value)}
                  autoComplete="country-name"
                  className={`${fieldCls(fieldErrors.country)} bg-white`}>
                  <option value="">Select country…</option>
                  {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
                </select>
                {fieldErrors.country && <p className="text-xs text-red-500 mt-1">{fieldErrors.country}</p>}
              </div>
            </div>
            <div>
              <label htmlFor="ap-gender" className="block text-xs font-semibold text-gray-600 mb-2">Gender *</label>
              <select
                id="ap-gender"
                value={form.gender}
                onChange={e => { set('gender', e.target.value); validateField('gender', e.target.value) }}
                onBlur={e => validateField('gender', e.target.value)}
                className={`${fieldCls(fieldErrors.gender)} bg-white`}
              >
                <option value="">Select…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non_binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
              {fieldErrors.gender && <p className="text-xs text-red-500 mt-1">{fieldErrors.gender}</p>}
            </div>
            <div>
              <label htmlFor="ap-neighborhood" className="block text-xs font-semibold text-gray-600 mb-2">Neighborhood / Area *</label>
              <select id="ap-neighborhood" value={form.neighborhood}
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
              <label htmlFor="ap-phone" className="block text-xs font-semibold text-gray-600 mb-2">Phone (WhatsApp) *</label>
              <input id="ap-phone" type="tel" value={form.phone}
                onChange={e => set('phone', e.target.value)}
                onBlur={e => validateField('phone', e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+90 555 000 0000" className={fieldCls(fieldErrors.phone)} />
              {fieldErrors.phone && <p className="text-xs text-red-500 mt-1">{fieldErrors.phone}</p>}
            </div>
            <div>
              <label htmlFor="ap-email" className="block text-xs font-semibold text-gray-600 mb-2">Email *</label>
              <input id="ap-email" type="email" value={form.email}
                onChange={e => set('email', e.target.value)}
                onBlur={e => validateField('email', e.target.value)}
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com" className={fieldCls(fieldErrors.email)} />
              {fieldErrors.email && <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
            </div>
            {/* Instagram + LinkedIn moved to profile-edit post-approval —
                most applicants filled only one anyway, kept the funnel lighter. */}
          </>}

          {/* Step 2: About You */}
          {step === 1 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">About You</h2>
            <div>
              <label htmlFor="ap-profession" className="block text-xs font-semibold text-gray-600 mb-2">What do you do professionally?</label>
              <input id="ap-profession" type="text" value={form.profession} onChange={e => set('profession', e.target.value)}
                placeholder="e.g. Product designer, entrepreneur…" className={inputCls} />
            </div>
            <div>
              <label htmlFor="ap-time" className="block text-xs font-semibold text-gray-600 mb-2">How long have you been in Istanbul?</label>
              <input id="ap-time" type="text" value={form.timeInCity} onChange={e => set('timeInCity', e.target.value)}
                placeholder="e.g. 3 years, just arrived…" className={inputCls} />
            </div>
            <div>
              <label htmlFor="ap-reason" className="block text-xs font-semibold text-gray-600 mb-2">What brings you here?</label>
              <input id="ap-reason" type="text" value={form.reasonHere} onChange={e => set('reasonHere', e.target.value)}
                placeholder="e.g. Work, relocated, digital nomad…" className={inputCls} />
            </div>
            <div>
              <label htmlFor="ap-bio" className="block text-xs font-semibold text-gray-600 mb-2">Anything else you&apos;d like us to know?</label>
              <textarea id="ap-bio" rows={3} value={form.bio} onChange={e => set('bio', e.target.value)}
                placeholder="What you're passionate about, looking for…"
                className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label htmlFor="ap-source" className="block text-xs font-semibold text-gray-600 mb-2">How did you hear about us?</label>
              <select id="ap-source" value={form.source} onChange={e => set('source', e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">Select…</option>
                <option value="instagram">Instagram</option>
                <option value="friend">Friend / referral</option>
                <option value="google">Google</option>
                <option value="event">Attended an event</option>
                <option value="other">Other</option>
              </select>
            </div>
          </>}

          {/* Step 3: Community Fit — one consolidated prompt replaces three
              overlapping ones (whyJoin / enjoyWith / goodCommunity). */}
          {step === 2 && <>
            <h2 className="font-bold text-gray-900 text-base mb-1">Community Fit</h2>
            <div>
              <label htmlFor="ap-community" className="block text-xs font-semibold text-gray-600 mb-2">
                What kind of community are you looking for — and what would you bring to it?
              </label>
              <textarea id="ap-community" rows={6} value={form.aboutCommunity} onChange={e => set('aboutCommunity', e.target.value)}
                placeholder="The community you're hoping to find, the people you'd love to spend time with, what you'd add to the mix…"
                className={`${inputCls} resize-none`} />
              <p className="text-xs text-gray-400 mt-1">A few sentences is plenty. Specific beats long.</p>
            </div>
          </>}

          {/* Step 4: Languages + Interests + Social Style */}
          {step === 3 && <>
            {/* Languages chip multi-select — top matching axis for an
                expat-heavy community, currently missing from apply. */}
            <div>
              <h2 className="font-bold text-gray-900 text-base mb-1">Languages you speak</h2>
              <p className="text-xs text-gray-400 mb-2">Pick all that apply.</p>
              <div className="flex flex-wrap gap-2">
                {COMMON_LANGUAGES.map(lang => {
                  const active = languages.includes(lang)
                  return (
                    <button key={lang} type="button"
                      onClick={() => setLanguages(prev =>
                        prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
                      )}
                      className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                        active ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      {lang}
                    </button>
                  )
                })}
              </div>
            </div>

            <h2 className="font-bold text-gray-900 text-base mb-1 pt-4 mt-4 border-t border-gray-100">Interests & Activities</h2>
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

          {/* Step 5: Contribution + Social Judgment + Verification merged. The
              first three step-4 sections were each short; folding them into
              Verification keeps the screening signal but drops perceived
              length from 6 steps to 5. */}
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

            <div className="pt-4 mt-2 border-t border-gray-100">
              <h3 className="font-bold text-gray-900 text-sm mb-3">Social Judgment</h3>
              <div>
                <label htmlFor="ap-social" className="block text-xs font-semibold text-gray-600 mb-2">
                  Tell us about a time you handled a difficult social situation well.
                </label>
                <textarea id="ap-social" rows={4} value={form.socialJudgment} onChange={e => set('socialJudgment', e.target.value)}
                  placeholder="A few sentences — what happened, what you did, how it landed."
                  className={`${inputCls} resize-none`} />
              </div>
            </div>

            <h2 className="font-bold text-gray-900 text-base mb-1 pt-6 mt-4 border-t border-gray-100">Verification</h2>
            <p className="text-xs text-gray-400 mb-3">We review every application personally — a real photo of you is required and helps us keep the community genuine.</p>
            <div>
              <label htmlFor="ap-photo" className="block text-xs font-semibold text-gray-600 mb-2">Profile photo — a real photo of you <span className="text-red-400">*</span></label>
              <input id="ap-photo" ref={photoInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} />
              {localPhoto || form.profilePhoto ? (
                <div className="flex items-center gap-4">
                  <img src={localPhoto || avatarUrl(form.profilePhoto, 128)} alt="Profile" loading="lazy" decoding="async" className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-200" />
                  <button type="button" onClick={() => photoInputRef.current?.click()}
                    className="text-sm text-amber-600 hover:underline font-medium">Change photo</button>
                </div>
              ) : (
                <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}
                  className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 flex flex-col items-center gap-2 hover:border-amber-400 transition-colors disabled:opacity-50">
                  {photoUploading ? <span className="text-sm text-gray-400">Uploading…</span> : <>
                    <span className="text-3xl">📸</span>
                    <span className="text-sm font-medium text-gray-600">Upload a real photo of you</span>
                    <span className="text-xs text-gray-400 px-4 text-center">Face clearly visible — no logos, avatars, or group shots. JPG or PNG, max 4MB</span>
                  </>}
                </button>
              )}
            </div>

            {/* Open-to flags — pre-set at apply so on approval the new
                member lands discoverable in /members filters. Skipping these
                doesn't block the application. */}
            <div className="pt-4 mt-2 border-t border-gray-100 space-y-2">
              <h3 className="font-bold text-gray-900 text-sm">Open to… <span className="font-normal text-gray-400">(optional)</span></h3>
              <p className="text-xs text-gray-400 mb-1">Lets newcomers and locals reach out for the right kind of meet-up.</p>
              {[
                { key: 'openToCoffee'   as const, emoji: '☕', label: 'Coffee with newcomers' },
                { key: 'openToLanguage' as const, emoji: '🗣️', label: 'Language exchange'    },
                { key: 'openToHosting'  as const, emoji: '🏠', label: 'Hosting visitors'     },
              ].map(opt => (
                <label key={opt.key} className="flex items-center gap-3 cursor-pointer py-1">
                  <input type="checkbox"
                    checked={form[opt.key] as boolean}
                    onChange={e => setForm(f => ({ ...f, [opt.key]: e.target.checked }))}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400" />
                  <span className="text-sm text-gray-700"><span className="mr-1.5">{opt.emoji}</span>{opt.label}</span>
                </label>
              ))}
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
            <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} resetSignal={turnstileReset} />
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

