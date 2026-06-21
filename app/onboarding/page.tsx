'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { vibeConfig, formatShortDate, formatTime } from '@/lib/data'
import type { VibeTag, Club, Event } from '@/lib/data'
import { ONBOARDING_NEIGHBORHOODS as NEIGHBORHOODS } from '@/lib/onboarding-neighborhoods'
import { useAuth } from '@/contexts/AuthContext'
import Turnstile from '@/components/Turnstile'

const accountSchema = z.object({
  name:        z.string().min(2, 'Full name is required'),
  email:       z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password:    z.string().min(8, 'Password must be at least 8 characters'),
  phone:       z.string().min(6, 'Phone number is required'),
  nationality: z.string().min(1, 'Nationality is required'),
  languages:   z.string().min(1, 'At least one language is required'),
  interests:   z.string().min(1, 'At least one interest is required'),
  industry:           z.string().optional(),
  professionalRole:   z.string().optional(),
  professionalStatus: z.string().optional(),
  linkedin:           z.string().optional(),
})
type AccountValues = z.infer<typeof accountSchema>

const TOTAL_STEPS = 6
const VIBES = Object.keys(vibeConfig) as VibeTag[]

const INDUSTRIES = [
  'Tech', 'Finance', 'Real Estate', 'Creative & Design', 'Marketing',
  'Hospitality', 'Education', 'Health & Wellness', 'Legal', 'Consulting',
  'Retail', 'Manufacturing', 'Non-profit', 'Other',
]

const PROFESSIONAL_STATUS_OPTIONS = [
  { id: 'open_to_networking', label: '🤝 Open to networking' },
  { id: 'hiring',             label: '🚀 Hiring / Recruiting' },
  { id: 'seeking_advice',     label: '💡 Seeking advice'     },
  { id: 'social_only',        label: '🥨 Social only'        },
]

// ─── Progress bar ────────────────────────────────────────────────────────────
function ProgressBar({ step }: { step: number }) {
  const pct = Math.round((step / TOTAL_STEPS) * 100)
  return (
    <div className="w-full h-1 bg-gray-100">
      <div
        className="h-full bg-amber-500 transition-all duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ─── Step header ─────────────────────────────────────────────────────────────
// Two modes:
//   - step mode (default): brand + "N / TOTAL" counter + optional Skip.
//   - welcome mode (signInHref set): brand + Sign-in CTA, rendered as
//     a <Link> so Next prefetches /login and SR users get proper
//     anchor semantics. Step 1's header used to be a hand-rolled copy
//     of this; folding it in keeps the brand row in sync across all
//     6 steps.
function StepHeader({
  step,
  onSkip,
  signInHref,
}: {
  step?: number
  onSkip?: () => void
  signInHref?: string
}) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">😊</span>
        <span className="font-bold text-gray-900 text-sm">Smileys Community</span>
      </div>
      {signInHref ? (
        <Link
          href={signInHref}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium"
        >
          Sign in
        </Link>
      ) : (
        <>
          <span className="text-xs font-semibold text-gray-400">
            {step} / {TOTAL_STEPS}
          </span>
          {onSkip && (
            <button
              onClick={onSkip}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium"
            >
              Skip
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ─── Step eyebrow ────────────────────────────────────────────────────────────
// Repeated "Step N of TOTAL" label that sits above each step's h1.
// Steps 2-5 use the numeric form; step 6 passes "Last step".
function StepEyebrow({ text }: { text: string }) {
  return (
    <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">
      {text}
    </p>
  )
}

// ─── Selectable card ─────────────────────────────────────────────────────────
// Single component for the three near-identical pick-an-option grids
// across steps 2 (clubs), 3 (vibes), and 4 (neighborhoods). All three
// share the relative button + bordered card + checkmark-corner overlay.
// Checkmark is uniform amber across all card types — previous variants
// (w-6/w-5, amber/dark) were just inconsistency, not deliberate
// differentiation. Padding stays prop-controlled because card content
// scale differs (clubs need p-5 breathing room, neighborhoods p-4).
function SelectableCard({
  selected,
  onSelect,
  selectedClass = 'border-amber-500 bg-amber-50',
  unselectedClass = 'border-gray-200 bg-white hover:border-amber-300',
  padding = 'p-5',
  children,
}: {
  selected: boolean
  onSelect: () => void
  selectedClass?: string
  unselectedClass?: string
  padding?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative text-left rounded-2xl ${padding} border-2 transition-all duration-150 ${
        selected ? selectedClass : unselectedClass
      }`}
    >
      {selected && (
        <span aria-hidden="true" className="absolute top-3 right-3 w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {children}
    </button>
  )
}

// ─── Nav buttons ─────────────────────────────────────────────────────────────
function NavRow({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
}: {
  onBack?: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
}) {
  return (
    <div className={`flex gap-3 pt-6 ${onBack ? 'justify-between' : 'justify-end'}`}>
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
          </svg>
          Back
        </button>
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors ml-auto"
      >
        {nextLabel}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </button>
    </div>
  )
}

// ─── Password show/hide toggle ───────────────────────────────────────────────
// Two-state SVG eye button overlaid on the password input. Extracted
// because the inline pair of 10-line SVG paths bloated the form's
// JSX and made the surrounding label/error structure hard to follow.
function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? 'Hide password' : 'Show password'}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
    >
      {visible ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      )}
    </button>
  )
}

// ─── Tiny pluralize helper ───────────────────────────────────────────────────
// Three "Continue with X club/vibe/area(s)" CTAs used to inline the
// `count > 1 ? 's' : ''` branch every time. Helper keeps the call
// sites short and the pluralization consistent.
function pluralize(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

// ─── Main component ───────────────────────────────────────────────────────────
// localStorage key for in-flight onboarding state. Bump the suffix
// if the persisted shape ever changes.
const STORAGE_KEY = 'smileys_onboarding_v1'

export default function OnboardingPage() {
  return <Suspense><OnboardingInner /></Suspense>
}

function OnboardingInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { setUser }  = useAuth()

  const [step,                   setStep]                   = useState(1)
  const [selectedClubIds,        setSelectedClubIds]        = useState<string[]>([])
  const [selectedVibes,          setSelectedVibes]          = useState<VibeTag[]>([])
  const [selectedNeighborhoods,  setSelectedNeighborhoods]  = useState<string[]>([])
  const [emailLocked,            setEmailLocked]            = useState(false)
  const [showPassword,           setShowPassword]           = useState(false)
  const [submitted,              setSubmitted]              = useState(false)
  const [turnstileToken,         setTurnstileToken]         = useState('')
  const [accountStatus,          setAccountStatus]          = useState<'approved' | 'pending'>('pending')
  const [clubs,                  setClubs]                  = useState<Club[]>([])
  const [events,                 setEvents]                 = useState<Event[]>([])
  // Flips true after the initial /api/clubs + /api/events fetch
  // settles (success or failure). Used to distinguish "fetch hasn't
  // returned yet" from "fetch returned zero" on the welcome tiles —
  // previously a Math.max(.length, 1) floor showed "1+" in both
  // cases, which was misleading on slow networks.
  const [dataLoaded,             setDataLoaded]             = useState(false)

  const { register, handleSubmit: rhfSubmit, formState: { errors, isSubmitting }, setValue, watch, setError } =
    useForm<AccountValues>({ resolver: zodResolver(accountSchema), mode: 'onBlur' })

  const formValues = watch()

  useEffect(() => {
    Promise.all([
      fetch('/app/api/clubs').then(r => r.json()),
      fetch('/app/api/events?upcoming=1&all=1').then(r => r.json()),
    ]).then(([c, e]) => {
      setClubs(Array.isArray(c) ? c : [])
      setEvents(Array.isArray(e?.events) ? e.events : [])
    }).catch(() => {}).finally(() => setDataLoaded(true))
  }, [])

  // Restore in-flight onboarding from localStorage on mount. Runs
  // BEFORE the URL-prefill effect below so an `?email=…` deep link
  // (approved-application path) still wins over a stale partial
  // selection from an earlier visit.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as { step?: number; clubs?: string[]; vibes?: VibeTag[]; neighborhoods?: string[] }
      if (typeof data.step === 'number' && data.step >= 1 && data.step <= TOTAL_STEPS) setStep(data.step)
      if (Array.isArray(data.clubs))         setSelectedClubIds(data.clubs)
      if (Array.isArray(data.vibes))         setSelectedVibes(data.vibes)
      if (Array.isArray(data.neighborhoods)) setSelectedNeighborhoods(data.neighborhoods)
    } catch {}
  }, [])

  // Persist on any change to the selection state or step so a refresh
  // mid-flow resumes where the user left off.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        step,
        clubs:         selectedClubIds,
        vibes:         selectedVibes,
        neighborhoods: selectedNeighborhoods,
      }))
    } catch {}
  }, [step, selectedClubIds, selectedVibes, selectedNeighborhoods])

  // Clear on successful submit so the next visitor on this device
  // doesn't resume someone else's onboarding state.
  useEffect(() => {
    if (submitted) {
      try { localStorage.removeItem(STORAGE_KEY) } catch {}
    }
  }, [submitted])

  // Pre-fill from approved application when email is in URL
  useEffect(() => {
    const email = searchParams.get('email')
    if (!email) return
    fetch(`/app/api/apply/prefill?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(app => {
        if (!app) return
        setValue('email',       email)
        setValue('name',        app.fullName    ?? '')
        setValue('phone',       app.phone       ?? '')
        setValue('nationality', app.country ?? '')
        setValue('interests',   Array.isArray(app.interests) ? app.interests.join(', ') : '')
        setEmailLocked(true)
        setStep(6)
      })
      .catch(() => {})
  }, [searchParams])

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  const back = () => setStep((s) => Math.max(s - 1, 1))
  const skip = () => setStep(6)

  // Focus the active step's h1 on every step change so SR users land
  // on the new step's title instead of staying on the Continue button
  // that just vanished. Skip on step 1 (initial mount) so the page
  // doesn't yank focus before the user has read anything.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (step > 1) headingRef.current?.focus()
  }, [step])

  function toggleClub(id: string) {
    setSelectedClubIds((p) => p.includes(id) ? p.filter((c) => c !== id) : [...p, id])
  }
  function toggleVibe(v: VibeTag) {
    setSelectedVibes((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])
  }
  function toggleNeighborhood(id: string) {
    setSelectedNeighborhoods((p) => p.includes(id) ? p.filter((n) => n !== id) : [...p, id])
  }

  // Recommendation logic. When the user has no selections, every
  // event passes the predicate trivially and `recommended === events`,
  // so skip the per-event work entirely.
  const hasSelection =
    selectedClubIds.length > 0 ||
    selectedVibes.length > 0 ||
    selectedNeighborhoods.length > 0
  const recommended = hasSelection
    ? events.filter((e) => {
        const clubOk  = selectedClubIds.length === 0 || selectedClubIds.includes(e.clubId)
        const vibeOk  = selectedVibes.length === 0 || e.vibes.some((v) => selectedVibes.includes(v))
        const nbOk    = selectedNeighborhoods.length === 0 || selectedNeighborhoods.some((nid) => {
          const nb = NEIGHBORHOODS.find((n) => n.id === nid)
          return nb && e.neighborhood.toLowerCase().includes(nb.label.toLowerCase())
        })
        return clubOk && vibeOk && nbOk
      })
    : events
  const displayEvents = (recommended.length > 0 ? recommended : events).slice(0, 5)

  async function onAccountSubmit(values: AccountValues) {
    try {
      const primaryNeighborhood = selectedNeighborhoods.length > 0
        ? (NEIGHBORHOODS.find(n => n.id === selectedNeighborhoods[0])?.label ?? null)
        : null

      const res  = await fetch('/app/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         values.name.trim(),
          email:        values.email.trim(),
          password:     values.password,
          phone:        values.phone.trim(),
          nationality:  values.nationality.trim(),
          languages:    values.languages.split(',').map((s: string) => s.trim()).filter(Boolean),
          interests:    values.interests.split(',').map((s: string) => s.trim()).filter(Boolean),
          clubIds:      selectedClubIds,
          neighborhood: primaryNeighborhood,
          industry:           values.industry,
          professionalRole:   values.professionalRole,
          professionalStatus: values.professionalStatus,
          linkedin:           values.linkedin,
          _cf:          turnstileToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError('email', { message: data.error ?? 'Registration failed' }); return }

      // A2 full fix: server no longer creates an auto-session.
      // Both new-registration and already-registered responses
      // come back as { pending: true, checkEmail: true } — we
      // can't distinguish them client-side, which is the point
      // (no enumeration). The success screen below now reads as
      // "check your email to continue" regardless of which path
      // ran on the server.
      setSubmitted(true)
    } catch {
      setError('email', { message: 'Something went wrong. Try again.' })
    }
  }

  // ── Shared wrapper ──
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <ProgressBar step={step} />

      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-5 py-8">

        {/* ══════════════ STEP 1 — Welcome ══════════════ */}
        {step === 1 && (
          <div className="flex flex-col flex-1">
            <StepHeader signInHref="/login" />

            <div className="flex-1 flex flex-col justify-center text-center pb-6">
              {/* Hero */}
              <div aria-hidden="true" className="text-7xl mb-6 select-none">🏙️</div>
              <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-3 leading-tight">
                Your social life starts here.
              </h1>
              <p className="text-gray-600 text-lg mb-10 leading-relaxed">
                A curated global community. Real events, real people, real connections.
              </p>

              {/* Value props */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
                {[
                  { emoji: '📅', label: dataLoaded ? `${events.length}` : '—', sub: 'upcoming events' },
                  { emoji: '🏛️', label: dataLoaded ? `${clubs.length}`  : '—', sub: 'active clubs' },
                  { emoji: '🌍', label: 'Free',                                  sub: 'to apply' },
                ].map((v) => (
                  <div key={v.sub} className="bg-amber-50 rounded-2xl p-4">
                    <div aria-hidden="true" className="text-2xl mb-1">{v.emoji}</div>
                    <div className="font-extrabold text-gray-900 text-lg leading-none">{v.label}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{v.sub}</div>
                  </div>
                ))}
              </div>

              <button
                onClick={next}
                className="btn-primary--lg w-full mb-3"
              >
                Get started — it&apos;s free
              </button>
              <button
                onClick={() => router.push('/login')}
                className="w-full py-3.5 rounded-2xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors"
              >
                I already have an account
              </button>
            </div>
          </div>
        )}

        {/* ══════════════ STEP 2 — Select Clubs ══════════════ */}
        {step === 2 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-7">
              <StepEyebrow text={`Step 2 of ${TOTAL_STEPS}`} />
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2 focus:outline-none">
                What are you into?
              </h1>
              <p className="text-gray-600">Pick the clubs that match your vibe. Select as many as you like.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
              {clubs.map((club) => (
                <SelectableCard
                  key={club.id}
                  selected={selectedClubIds.includes(club.id)}
                  onSelect={() => toggleClub(club.id)}
                >
                  <div aria-hidden="true" className={`w-11 h-11 rounded-xl ${club.bgColor} flex items-center justify-center text-2xl mb-3`}>
                    {club.emoji}
                  </div>
                  <div className="font-bold text-gray-900 mb-0.5">{club.name}</div>
                  <div className={`text-xs font-semibold ${club.color} mb-1.5`}>{club.category}</div>
                  <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">{club.description}</p>
                  <div className="mt-2 text-xs text-gray-400">{club.memberCount} members</div>
                </SelectableCard>
              ))}
            </div>

            <NavRow
              onNext={next}
              nextLabel={selectedClubIds.length > 0 ? `Continue with ${pluralize(selectedClubIds.length, 'club')}` : 'Skip this step'}
            />
          </div>
        )}

        {/* ══════════════ STEP 3 — Select Vibe ══════════════ */}
        {step === 3 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-7">
              <StepEyebrow text={`Step 3 of ${TOTAL_STEPS}`} />
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2 focus:outline-none">
                What&apos;s your vibe?
              </h1>
              <p className="text-gray-600">How do you like to show up? Pick everything that fits.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-2">
              {VIBES.map((vibe) => {
                const cfg = vibeConfig[vibe]
                const sel = selectedVibes.includes(vibe)
                return (
                  <SelectableCard
                    key={vibe}
                    selected={sel}
                    onSelect={() => toggleVibe(vibe)}
                    selectedClass={`${cfg.border} ${cfg.bg}`}
                    unselectedClass="border-gray-200 bg-white hover:border-gray-300"
                  >
                    <div aria-hidden="true" className="text-3xl mb-2">{cfg.emoji}</div>
                    <div className={`font-bold text-base mb-1 ${sel ? cfg.text : 'text-gray-900'}`}>{vibe}</div>
                    <p className="text-xs text-gray-600 leading-relaxed">{cfg.description}</p>
                  </SelectableCard>
                )
              })}
            </div>

            <NavRow
              onBack={back}
              onNext={next}
              nextLabel={selectedVibes.length > 0 ? `Continue with ${pluralize(selectedVibes.length, 'vibe')}` : 'Skip this step'}
            />
          </div>
        )}

        {/* ══════════════ STEP 4 — Select Location ══════════════ */}
        {step === 4 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-7">
              <StepEyebrow text={`Step 4 of ${TOTAL_STEPS}`} />
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2 focus:outline-none">
                Where do you hang out?
              </h1>
              <p className="text-gray-600">Pick your favorite neighborhoods.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-2">
              {NEIGHBORHOODS.map((nb) => (
                <SelectableCard
                  key={nb.id}
                  selected={selectedNeighborhoods.includes(nb.id)}
                  onSelect={() => toggleNeighborhood(nb.id)}
                  padding="p-4"
                >
                  <div aria-hidden="true" className="text-2xl mb-1.5">{nb.emoji}</div>
                  <div className="font-bold text-gray-900 text-sm leading-tight">{nb.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5 leading-snug">{nb.desc}</div>
                </SelectableCard>
              ))}
            </div>

            <NavRow
              onBack={back}
              onNext={next}
              nextLabel={selectedNeighborhoods.length > 0 ? `Continue with ${pluralize(selectedNeighborhoods.length, 'area')}` : 'Skip this step'}
            />
          </div>
        )}

        {/* ══════════════ STEP 5 — Event Recommendations ══════════════ */}
        {step === 5 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-6">
              <StepEyebrow text={`Step 5 of ${TOTAL_STEPS}`} />
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2 focus:outline-none">
                {recommended.length > 0 ? 'Your lineup 🎉' : 'Explore everything'}
              </h1>
              <p className="text-gray-600 text-sm">
                {recommended.length > 0
                  ? `${displayEvents.length} event${displayEvents.length > 1 ? 's' : ''} matched your profile.`
                  : "No exact match — here's everything coming up."}
              </p>

              {/* Selection chips */}
              {(selectedClubIds.length > 0 || selectedVibes.length > 0 || selectedNeighborhoods.length > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {selectedClubIds.map((id) => {
                    const c = clubs.find((x) => x.id === id)
                    if (!c) return null
                    return (
                      <span key={id} className={`badge ${c.bgColor} ${c.color} text-xs`}>
                        {c.emoji} {c.name}
                      </span>
                    )
                  })}
                  {selectedVibes.map((v) => {
                    const cfg = vibeConfig[v]
                    return (
                      <span key={v} className={`badge ${cfg.bg} ${cfg.text} text-xs`}>
                        {cfg.emoji} {v}
                      </span>
                    )
                  })}
                  {selectedNeighborhoods.map((nid) => {
                    const nb = NEIGHBORHOODS.find((n) => n.id === nid)
                    if (!nb) return null
                    return (
                      <span key={nid} className="badge bg-gray-100 text-gray-600 text-xs">
                        {nb.emoji} {nb.label}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3 mb-4">
              {displayEvents.map((event) => {
                const previews   = event.attendeePreviews ?? []
                const goingCount = event.totalSpots - event.spotsLeft
                const fillPct    = (goingCount / event.totalSpots) * 100

                return (
                  <div
                    key={event.id}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-4"
                  >
                    <div aria-hidden="true" className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-2xl shrink-0">
                      {event.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-1 mb-1">
                        {event.vibes.map((v) => {
                          const cfg = vibeConfig[v]
                          return (
                            <span key={v} className={`badge ${cfg.bg} ${cfg.text} text-xs py-0.5`}>
                              {cfg.emoji} {v}
                            </span>
                          )
                        })}
                      </div>
                      <h3 className="font-bold text-gray-900 text-sm leading-snug">{event.title}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatShortDate(event.date)} · {formatTime(event.time)} · {event.neighborhood}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        {previews.length > 0 && (
                          <div className="flex -space-x-1.5">
                            {previews.slice(0, 3).map((a) => (
                              <div key={a.id} className="w-5 h-5 rounded-full ring-1 ring-white flex items-center justify-center text-white text-[8px] font-bold"
                                style={{ backgroundColor: a.color }}>
                                {a.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-gray-600">
                          <span className="font-semibold text-gray-700">{goingCount}</span> going
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-between shrink-0 gap-2">
                      <div className="font-bold text-sm text-right">
                        {event.price === 0
                          ? <span className="text-green-600">Free</span>
                          : <span className="text-gray-900">₺{event.price}</span>}
                      </div>
                      {event.limitedSpots && event.spotsLeft <= 5 && (
                        <span className="text-xs text-red-500 font-semibold">{event.spotsLeft} left</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <NavRow
              onBack={back}
              onNext={next}
              nextLabel="Apply to join →"
            />
          </div>
        )}

        {/* ══════════════ STEP 6 — Apply CTA (non-approved path) ══════════════ */}
        {step === 6 && !submitted && !emailLocked && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
            <div aria-hidden="true" className="text-6xl mb-6">😊</div>
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-3 focus:outline-none">
              Ready to join?
            </h1>
            <p className="text-gray-600 mb-2 text-lg">We review every application personally.</p>
            <p className="text-sm text-gray-400 mb-10 max-w-xs mx-auto">
              Fill out a short application and we&apos;ll get back to you within 24 hours.
            </p>
            <Link
              href="/apply"
              className="btn-primary--lg w-full mb-4"
            >
              Submit an application
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <button
              onClick={back}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Back to recommendations
            </button>
          </div>
        )}

        {/* ══════════════ STEP 6 — Account creation (approved application path) ══════════════ */}
        {step === 6 && !submitted && emailLocked && (
          <div>
            <StepHeader step={step} />
            <div className="mb-7">
              <StepEyebrow text="Last step" />
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2 focus:outline-none">
                {`Welcome, ${(formValues.name || '').split(' ')[0] || 'there'}! 🎉`}
              </h1>
              <p className="text-gray-600">
                Your info is pre-filled from your application — just set a password.
              </p>
            </div>

            {/* Form — react-hook-form + zod */}
            <form onSubmit={rhfSubmit(onAccountSubmit)} className="space-y-4 mb-6" noValidate>
              {(() => {
                const cls = (field: keyof AccountValues) =>
                  `w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-colors ${
                    errors[field] ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-gray-200 focus:ring-amber-400'
                  }`
                return (
                  <>
                    <div>
                      <label htmlFor="ob-name" className="block text-xs font-semibold text-gray-600 mb-1.5">Full name</label>
                      <input id="ob-name" type="text" placeholder="e.g. Ayşe Kaya" {...register('name')} className={cls('name')} />
                      {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="ob-email" className="block text-xs font-semibold text-gray-600 mb-1.5">Email address</label>
                      <input id="ob-email" type="email" placeholder="you@example.com" readOnly={emailLocked}
                        {...register('email')}
                        className={`${cls('email')} ${emailLocked ? 'bg-gray-50 text-gray-600' : ''}`} />
                      {emailLocked && <p className="text-xs text-gray-400 mt-1">✓ Confirmed from your application</p>}
                      {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="ob-password" className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
                      <div className="relative">
                        <input id="ob-password" type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters"
                          {...register('password')} className={`${cls('password')} pr-12`} />
                        <PasswordToggle visible={showPassword} onToggle={() => setShowPassword(p => !p)} />
                      </div>
                      {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="ob-phone" className="block text-xs font-semibold text-gray-600 mb-1.5">Phone</label>
                        <input id="ob-phone" type="tel" placeholder="+90 555 000 0000" {...register('phone')} className={cls('phone')} />
                        {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone.message}</p>}
                      </div>
                      <div>
                        <label htmlFor="ob-nationality" className="block text-xs font-semibold text-gray-600 mb-1.5">Nationality</label>
                        <input id="ob-nationality" type="text" placeholder="e.g. Turkish" {...register('nationality')} className={cls('nationality')} />
                        {errors.nationality && <p className="text-xs text-red-500 mt-1">{errors.nationality.message}</p>}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="ob-languages" className="block text-xs font-semibold text-gray-600 mb-1.5">Languages <span className="font-normal text-gray-400">comma separated</span></label>
                      <input id="ob-languages" type="text" placeholder="e.g. English, Turkish" {...register('languages')} className={cls('languages')} />
                      {errors.languages && <p className="text-xs text-red-500 mt-1">{errors.languages.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="ob-interests" className="block text-xs font-semibold text-gray-600 mb-1.5">Interests <span className="font-normal text-gray-400">comma separated</span></label>
                      <input id="ob-interests" type="text" placeholder="e.g. Sailing, Photography, Food" {...register('interests')} className={cls('interests')} />
                      {errors.interests && <p className="text-xs text-red-500 mt-1">{errors.interests.message}</p>}
                    </div>

                    <div className="pt-4 border-t border-gray-100">
                      <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Optional: Professional context
                      </p>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <select {...register('industry')} className={`${cls('industry')} bg-white`}>
                          <option value="">Industry…</option>
                          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                        </select>
                        <input type="text" placeholder="Role (e.g. Founder)" {...register('professionalRole')} className={cls('professionalRole')} />
                      </div>
                      <select {...register('professionalStatus')} className={`${cls('professionalStatus')} bg-white mb-3`}>
                        <option value="">Professional networking goal…</option>
                        {PROFESSIONAL_STATUS_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                      </select>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">linkedin.com/in/</span>
                        <input type="text" placeholder="your-name" {...register('linkedin')} className={`${cls('linkedin')} pl-28`} />
                      </div>
                    </div>

                    <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />

                    <button type="submit" disabled={isSubmitting}
                      className="btn-primary--lg w-full disabled:opacity-50 disabled:cursor-not-allowed">
                      {isSubmitting ? 'Creating account…' : 'Create my account'}
                    </button>
                  </>
                )
              })()}
            </form>

            <p className="text-xs text-center text-gray-400">
              By joining you agree to our{' '}
              <span className="underline cursor-pointer">Terms</span> and{' '}
              <span className="underline cursor-pointer">Privacy Policy</span>.
            </p>

            <div className="flex justify-start pt-4">
              <button onClick={back}
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
                </svg>
                Back to recommendations
              </button>
            </div>
          </div>
        )}

        {/* ══════════════ SUCCESS — verify email then sign in ══════════════
            A2 full fix: the server no longer auto-creates a session on
            registration, so we can't differentiate new vs already-registered
            client-side (that's the point — no enumeration). Single
            "check your email" view covers both. The actual outcome flows
            through the email itself (verification link for new, sign-in
            link for already-registered). */}
        {step === 6 && submitted && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
            <div aria-hidden="true" className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6 text-4xl">
              📬
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-extrabold text-gray-900 tracking-tight mb-3 focus:outline-none">
              Check your email
            </h1>
            <p className="text-gray-600 mb-2 text-lg">Thanks, {formValues.name?.split(' ')[0]}.</p>
            <p className="text-sm text-gray-400 mb-8 max-w-xs mx-auto">
              We sent a link to <strong className="text-gray-600">{formValues.email}</strong>. Click it to confirm your account, then sign in.
            </p>
            {(selectedClubIds.length > 0 || selectedVibes.length > 0) && (
              <div className="bg-amber-50 rounded-2xl p-5 w-full mb-8 text-left">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">Your interests — saved for after you verify</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedClubIds.map((id) => {
                    const c = clubs.find((x) => x.id === id)
                    if (!c) return null
                    return <span key={id} className={`badge ${c.bgColor} ${c.color} text-xs`}>{c.emoji} {c.name}</span>
                  })}
                  {selectedVibes.map((v) => {
                    const cfg = vibeConfig[v]
                    return <span key={v} className={`badge ${cfg.bg} ${cfg.text} text-xs`}>{cfg.emoji} {v}</span>
                  })}
                </div>
              </div>
            )}
            <Link
              href="/login"
              className="btn-primary--lg w-full"
            >
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
