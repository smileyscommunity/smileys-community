'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { vibeConfig, formatShortDate, formatTime } from '@/lib/data'
import type { VibeTag, Club, Event } from '@/lib/data'
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
})
type AccountValues = z.infer<typeof accountSchema>

const TOTAL_STEPS = 6
const VIBES = Object.keys(vibeConfig) as VibeTag[]

const NEIGHBORHOODS = [
  // Central social hubs
  { id: 'kadikoy',        label: 'Kadıköy',        emoji: '🎨', desc: 'Artsy & vibrant'           },
  { id: 'moda',           label: 'Moda',            emoji: '☕', desc: 'Laid-back & local'          },
  { id: 'besiktas',       label: 'Beşiktaş',        emoji: '⚡', desc: 'Lively & social'            },
  { id: 'beyoglu',        label: 'Beyoğlu',         emoji: '🌃', desc: 'Culture & nightlife'        },
  { id: 'karakoy',        label: 'Karaköy',         emoji: '🖼️', desc: 'Galleries & coffee'         },
  { id: 'galata',         label: 'Galata',          emoji: '🏰', desc: 'Historic & charming'        },
  { id: 'cihangir',       label: 'Cihangir',        emoji: '🎭', desc: 'Bohemian & creative'        },
  { id: 'nisantasi',      label: 'Nişantaşı',       emoji: '👜', desc: 'Upscale & fashionable'      },
  { id: 'tesviikiye',     label: 'Teşvikiye',       emoji: '🌹', desc: 'Quiet luxury & boutiques'   },
  { id: 'taksim',         label: 'Taksim',          emoji: '🎶', desc: 'Central & buzzing'          },
  { id: 'ortakoy',        label: 'Ortaköy',         emoji: '🕌', desc: 'Iconic & scenic'            },
  { id: 'balat',          label: 'Balat',           emoji: '🌈', desc: 'Colourful & artsy'          },
  // European side
  { id: 'sisli',          label: 'Şişli',           emoji: '🏙️', desc: 'Business & fashion'         },
  { id: 'levent',         label: 'Levent',          emoji: '🏢', desc: 'Corporate & modern'         },
  { id: 'etiler',         label: 'Etiler',          emoji: '🌿', desc: 'Leafy & affluent'           },
  { id: 'bomonti',        label: 'Bomonti',         emoji: '🍺', desc: 'Up-and-coming'              },
  { id: 'bebek',          label: 'Bebek',           emoji: '🛥️', desc: 'Bosphorus & affluent'       },
  { id: 'fulya',          label: 'Fulya',           emoji: '🌿', desc: 'Trendy & residential'       },
  // Asian side
  { id: 'uskudar',        label: 'Üsküdar',         emoji: '🌅', desc: 'Traditional & scenic'       },
  { id: 'kuzguncuk',      label: 'Kuzguncuk',       emoji: '🌸', desc: 'Village charm & cafés'      },
  { id: 'caddebostan',    label: 'Caddebostan',     emoji: '🏖️', desc: 'Beachside & social'         },
  { id: 'fenerbahce',     label: 'Fenerbahçe',      emoji: '⚽', desc: 'Sporty & scenic'            },
  // Coastal
  { id: 'emirgan',        label: 'Emirgan',         emoji: '🌷', desc: 'Tulip gardens & Bosphorus'  },
  { id: 'zekeriyakoy',   label: 'Zekeriyaköy',    emoji: '🌲', desc: 'Forest retreat'             },
  { id: 'arnavutkoy',     label: 'Arnavutköy',      emoji: '🏡', desc: 'Village charm on the Bosphorus' },
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
function StepHeader({
  step,
  onSkip,
}: {
  step: number
  onSkip?: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-2">
        <span className="text-xl">😊</span>
        <span className="font-bold text-gray-900 text-sm">Smileys Community</span>
      </div>
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
    </div>
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

// ─── Main component ───────────────────────────────────────────────────────────
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

  const { register, handleSubmit: rhfSubmit, formState: { errors, isSubmitting }, setValue, watch, setError } =
    useForm<AccountValues>({ resolver: zodResolver(accountSchema), mode: 'onBlur' })

  const formValues = watch()

  useEffect(() => {
    Promise.all([
      fetch('/app/api/clubs').then(r => r.json()),
      fetch('/app/api/events').then(r => r.json()),
    ]).then(([c, e]) => {
      setClubs(Array.isArray(c) ? c : [])
      setEvents(Array.isArray(e) ? e.filter((ev: Event) => ev.date >= new Date().toISOString().split('T')[0]) : [])
    }).catch(() => {})
  }, [])

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

  function toggleClub(id: string) {
    setSelectedClubIds((p) => p.includes(id) ? p.filter((c) => c !== id) : [...p, id])
  }
  function toggleVibe(v: VibeTag) {
    setSelectedVibes((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])
  }
  function toggleNeighborhood(id: string) {
    setSelectedNeighborhoods((p) => p.includes(id) ? p.filter((n) => n !== id) : [...p, id])
  }

  // Recommendation logic
  const recommended = events.filter((e) => {
    const clubOk  = selectedClubIds.length === 0 || selectedClubIds.includes(e.clubId)
    const vibeOk  = selectedVibes.length === 0 || e.vibes.some((v) => selectedVibes.includes(v))
    const nbOk    = selectedNeighborhoods.length === 0 || selectedNeighborhoods.some((nid) => {
      const nb = NEIGHBORHOODS.find((n) => n.id === nid)
      return nb && e.neighborhood.toLowerCase().includes(nb.label.toLowerCase())
    })
    return clubOk && vibeOk && nbOk
  })
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
          _cf:          turnstileToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError('email', { message: data.error ?? 'Registration failed' }); return }

      setAccountStatus(data.status === 'approved' ? 'approved' : 'pending')
      setUser({ id: data.id, name: data.name, initials: data.initials, color: data.color, role: data.role, joinedEvents: [], joinedAt: new Date().toISOString().split('T')[0] })
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
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-2">
                <span className="text-xl">😊</span>
                <span className="font-bold text-gray-900 text-sm">Smileys Community</span>
              </div>
              <button
                onClick={() => router.push('/login')}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium"
              >
                Sign in
              </button>
            </div>

            <div className="flex-1 flex flex-col justify-center text-center pb-6">
              {/* Hero */}
              <div className="text-7xl mb-6 select-none">🏙️</div>
              <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-3 leading-tight">
                Your social life<br />starts here.
              </h1>
              <p className="text-gray-500 text-lg mb-10 leading-relaxed">
                A curated global community. Real events, real people, real connections.
              </p>

              {/* Value props */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
                {[
                  { emoji: '📅', label: `${Math.max(events.length, 1)}+`, sub: 'upcoming events' },
                  { emoji: '🏛️', label: `${Math.max(clubs.length, 1)}`, sub: 'active clubs' },
                  { emoji: '🌍', label: 'Free', sub: 'to apply' },
                ].map((v) => (
                  <div key={v.sub} className="bg-amber-50 rounded-2xl p-4">
                    <div className="text-2xl mb-1">{v.emoji}</div>
                    <div className="font-extrabold text-gray-900 text-lg leading-none">{v.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{v.sub}</div>
                  </div>
                ))}
              </div>

              <button
                onClick={next}
                className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-base transition-colors shadow-sm mb-3"
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
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Step 2 of {TOTAL_STEPS}</p>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
                What are you into?
              </h1>
              <p className="text-gray-500">Pick the clubs that match your vibe. Select as many as you like.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
              {clubs.map((club) => {
                const sel = selectedClubIds.includes(club.id)
                return (
                  <button
                    key={club.id}
                    onClick={() => toggleClub(club.id)}
                    className={`relative text-left rounded-2xl p-5 border-2 transition-all duration-150 ${
                      sel
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-gray-200 bg-white hover:border-amber-300'
                    }`}
                  >
                    {sel && (
                      <span className="absolute top-3 right-3 w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    <div className={`w-11 h-11 rounded-xl ${club.bgColor} flex items-center justify-center text-2xl mb-3`}>
                      {club.emoji}
                    </div>
                    <div className="font-bold text-gray-900 mb-0.5">{club.name}</div>
                    <div className={`text-xs font-semibold ${club.color} mb-1.5`}>{club.category}</div>
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{club.description}</p>
                    <div className="mt-2 text-xs text-gray-400">{club.memberCount} members</div>
                  </button>
                )
              })}
            </div>

            <NavRow
              onNext={next}
              nextLabel={selectedClubIds.length > 0 ? `Continue with ${selectedClubIds.length} club${selectedClubIds.length > 1 ? 's' : ''}` : 'Skip this step'}
            />
          </div>
        )}

        {/* ══════════════ STEP 3 — Select Vibe ══════════════ */}
        {step === 3 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-7">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Step 3 of {TOTAL_STEPS}</p>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
                What&apos;s your vibe?
              </h1>
              <p className="text-gray-500">How do you like to show up? Pick everything that fits.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-2">
              {VIBES.map((vibe) => {
                const cfg = vibeConfig[vibe]
                const sel = selectedVibes.includes(vibe)
                return (
                  <button
                    key={vibe}
                    onClick={() => toggleVibe(vibe)}
                    className={`relative text-left rounded-2xl p-5 border-2 transition-all duration-150 ${
                      sel
                        ? `${cfg.border} ${cfg.bg}`
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {sel && (
                      <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    <div className="text-3xl mb-2">{cfg.emoji}</div>
                    <div className={`font-bold text-base mb-1 ${sel ? cfg.text : 'text-gray-900'}`}>{vibe}</div>
                    <p className="text-xs text-gray-500 leading-relaxed">{cfg.description}</p>
                  </button>
                )
              })}
            </div>

            <NavRow
              onBack={back}
              onNext={next}
              nextLabel={selectedVibes.length > 0 ? `Continue with ${selectedVibes.length} vibe${selectedVibes.length > 1 ? 's' : ''}` : 'Skip this step'}
            />
          </div>
        )}

        {/* ══════════════ STEP 4 — Select Location ══════════════ */}
        {step === 4 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-7">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Step 4 of {TOTAL_STEPS}</p>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
                Where do you hang out?
              </h1>
              <p className="text-gray-500">Pick your favorite neighborhoods.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-2">
              {NEIGHBORHOODS.map((nb) => {
                const sel = selectedNeighborhoods.includes(nb.id)
                return (
                  <button
                    key={nb.id}
                    onClick={() => toggleNeighborhood(nb.id)}
                    className={`relative text-left rounded-2xl p-4 border-2 transition-all duration-150 ${
                      sel
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-gray-200 bg-white hover:border-amber-300'
                    }`}
                  >
                    {sel && (
                      <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    <div className="text-2xl mb-1.5">{nb.emoji}</div>
                    <div className="font-bold text-gray-900 text-sm leading-tight">{nb.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5 leading-snug">{nb.desc}</div>
                  </button>
                )
              })}
            </div>

            <NavRow
              onBack={back}
              onNext={next}
              nextLabel={
                selectedNeighborhoods.length > 0
                  ? `Continue with ${selectedNeighborhoods.length} area${selectedNeighborhoods.length > 1 ? 's' : ''}`
                  : 'Skip this step'
              }
            />
          </div>
        )}

        {/* ══════════════ STEP 5 — Event Recommendations ══════════════ */}
        {step === 5 && (
          <div>
            <StepHeader step={step} onSkip={skip} />
            <div className="mb-6">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Step 5 of {TOTAL_STEPS}</p>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
                {recommended.length > 0 ? 'Your lineup 🎉' : 'Explore everything'}
              </h1>
              <p className="text-gray-500 text-sm">
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
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-2xl shrink-0">
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
                        <span className="text-xs text-gray-500">
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
            <div className="text-6xl mb-6">😊</div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-3">
              Ready to join?
            </h1>
            <p className="text-gray-500 mb-2 text-lg">We review every application personally.</p>
            <p className="text-sm text-gray-400 mb-10 max-w-xs mx-auto">
              Fill out a short application and we&apos;ll get back to you within 24 hours.
            </p>
            <Link
              href="/apply"
              className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-base transition-colors shadow-sm flex items-center justify-center gap-2 mb-4"
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
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Last step</p>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
                {`Welcome, ${(formValues.name || '').split(' ')[0] || 'there'}! 🎉`}
              </h1>
              <p className="text-gray-500">
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
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full name</label>
                      <input type="text" placeholder="e.g. Ayşe Kaya" {...register('name')} className={cls('name')} />
                      {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email address</label>
                      <input type="email" placeholder="you@example.com" readOnly={emailLocked}
                        {...register('email')}
                        className={`${cls('email')} ${emailLocked ? 'bg-gray-50 text-gray-500' : ''}`} />
                      {emailLocked && <p className="text-xs text-gray-400 mt-1">✓ Confirmed from your application</p>}
                      {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
                      <div className="relative">
                        <input type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters"
                          {...register('password')} className={`${cls('password')} pr-12`} />
                        <button type="button" onClick={() => setShowPassword(p => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPassword ? (
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
                      </div>
                      {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone</label>
                        <input type="tel" placeholder="+90 555 000 0000" {...register('phone')} className={cls('phone')} />
                        {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone.message}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nationality</label>
                        <input type="text" placeholder="e.g. Turkish" {...register('nationality')} className={cls('nationality')} />
                        {errors.nationality && <p className="text-xs text-red-500 mt-1">{errors.nationality.message}</p>}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Languages <span className="font-normal text-gray-400">comma separated</span></label>
                      <input type="text" placeholder="e.g. English, Turkish" {...register('languages')} className={cls('languages')} />
                      {errors.languages && <p className="text-xs text-red-500 mt-1">{errors.languages.message}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Interests <span className="font-normal text-gray-400">comma separated</span></label>
                      <input type="text" placeholder="e.g. Sailing, Photography, Food" {...register('interests')} className={cls('interests')} />
                      {errors.interests && <p className="text-xs text-red-500 mt-1">{errors.interests.message}</p>}
                    </div>

                    <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />

                    <button type="submit" disabled={isSubmitting}
                      className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-base transition-colors shadow-sm">
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

        {/* ══════════════ SUCCESS ══════════════ */}
        {step === 6 && submitted && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
            {accountStatus === 'approved' ? (
              <>
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-3">
                  Welcome, {formValues.name?.split(' ')[0]}! 🎉
                </h1>
                <p className="text-gray-500 mb-2 text-lg">You're in.</p>
                <p className="text-sm text-gray-400 mb-10">
                  You're now part of Smileys — a curated global community.
                </p>
                <Link
                  href="/dashboard"
                  className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-base transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  Go to my dashboard
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6 text-4xl">
                  😊
                </div>
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-3">
                  Application received!
                </h1>
                <p className="text-gray-500 mb-2 text-lg">Thanks, {formValues.name?.split(' ')[0]}.</p>
                <p className="text-sm text-gray-400 mb-8 max-w-xs mx-auto">
                  We review every application personally. You'll get an email at <strong className="text-gray-600">{formValues.email}</strong> once you're approved — usually within 24 hours.
                </p>
                {(selectedClubIds.length > 0 || selectedVibes.length > 0) && (
                  <div className="bg-amber-50 rounded-2xl p-5 w-full mb-8 text-left">
                    <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">Your interests — saved for when you're approved</p>
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
                  href="/events"
                  className="w-full py-4 rounded-2xl bg-gray-900 hover:bg-gray-800 text-white font-bold text-base transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  Browse events while you wait
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
