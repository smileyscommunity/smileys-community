'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { resolveImageUrl, ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { COUNTRIES } from '@/lib/countries'
import { SkeletonList } from '@/components/Skeleton'
import { downscaleImage } from '@/lib/image-resize'
import PasswordToggle from '@/components/PasswordToggle'

const AVATAR_COLORS = [
  '#f472b6', '#60a5fa', '#fbbf24', '#f87171', '#fb923c',
  '#e879f9', '#34d399', '#a78bfa', '#22d3ee', '#4ade80',
]

const COMMON_LANGUAGES = [
  'English', 'Turkish', 'Spanish', 'French', 'German', 'Italian',
  'Portuguese', 'Arabic', 'Russian', 'Japanese', 'Korean', 'Chinese',
  'Dutch', 'Swedish', 'Polish', 'Greek', 'Hebrew', 'Persian',
]

const COMMON_INTERESTS = [
  'Travel', 'Photography', 'Hiking', 'Yoga', 'Cooking', 'Music',
  'Art', 'Film', 'Reading', 'Fitness', 'Dancing', 'Tech',
  'Entrepreneurship', 'Design', 'Food & Drink', 'Sailing', 'Cycling',
  'Coffee', 'Fashion', 'Gaming', 'Meditation', 'Language Learning',
  'Volunteering', 'Startups', 'Writing', 'Theatre', 'Architecture',
]

const SOCIAL_STYLES = [
  { id: 'deep_talker',       label: '🗣️ Deep Talker',       desc: 'Loves meaningful 1:1 conversations' },
  { id: 'social_butterfly',  label: '🎉 Social Butterfly',   desc: 'Energized by big groups' },
  { id: 'connector',         label: '🤝 Connector',          desc: 'Loves introducing people to each other' },
  { id: 'initiator',         label: '🔥 Initiator',          desc: 'Always the one to break the ice' },
  { id: 'laid_back',         label: '🧘 Laid-back',          desc: 'Goes with the flow, no agenda' },
  { id: 'new_in_town',       label: '🌱 New in Town',        desc: 'Fresh arrival still exploring' },
  { id: 'small_groups',      label: '☕ Small Groups',       desc: 'Prefers intimate settings' },
  { id: 'up_for_anything',   label: '🎭 Up for Anything',    desc: 'Spontaneous and adventurous' },
]

const LOOKING_FOR_OPTIONS = [
  { id: 'friendship',        label: 'Friendship'         },
  { id: 'networking',        label: 'Networking'          },
  { id: 'language_exchange', label: 'Language exchange'   },
  { id: 'collaboration',     label: 'Collaboration'       },
  { id: 'mentorship',        label: 'Mentorship'          },
  { id: 'activities',        label: 'Activity partners'   },
]

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

const inputCls = 'input'

function TagPicker({ options, selected, onChange, max }: {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  max?: number
}) {
  const [custom, setCustom] = useState('')
  function toggle(item: string) {
    if (selected.includes(item)) {
      onChange(selected.filter(s => s !== item))
    } else {
      if (max && selected.length >= max) return
      onChange([...selected, item])
    }
  }
  function addCustom() {
    const v = custom.trim()
    if (!v || selected.includes(v)) { setCustom(''); return }
    if (max && selected.length >= max) return
    onChange([...selected, v])
    setCustom('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              selected.includes(opt)
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {opt}
          </button>
        ))}
      </div>
      {/* Custom entry */}
      <div className="flex gap-2">
        <input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustom())}
          placeholder="Add custom…"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button type="button" onClick={addCustom} className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-medium transition-colors">
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.filter(s => !options.includes(s)).map(s => (
            <span key={s} className="flex items-center gap-1 text-xs bg-amber-500 text-white px-2.5 py-1 rounded-full">
              {s}
              <button onClick={() => onChange(selected.filter(x => x !== s))} className="ml-0.5 hover:opacity-70">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth()
  const router = useRouter()

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [stats,    setStats]    = useState<{ events: number; clubs: number; joinedAt: string } | null>(null)

  const [form, setForm] = useState({
    firstName:    '',
    lastName:     '',
    bio:          '',
    neighborhood: '',
    instagram:    '',
    linkedin:     '',
    phone:        '',
    gender:       '',
    nationality:  '',
    color:             user.color ?? '#f59e0b',
    profilePhoto:      '',
    languages:         [] as string[],
    interests:         [] as string[],
    socialStyles:      [] as string[],
    lookingFor:        [] as string[],
    profileVisibility: 'everyone',
    industry:           '',
    professionalRole:   '',
    professionalStatus: '',
  })

  const [photoUploading, setPhotoUploading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [pwForm,    setPwForm]    = useState({ current: '', next: '', confirm: '' })
  const [showPw,    setShowPw]    = useState(false)
  const [pwError,   setPwError]   = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [newEmail,      setNewEmail]      = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [showEmailPw,   setShowEmailPw]   = useState(false)
  const [emailError,    setEmailError]    = useState('')
  const [emailLoading,  setEmailLoading]  = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [showDeletePw,   setShowDeletePw]   = useState(false)
  const [deleteError,    setDeleteError]    = useState('')
  const [deleteLoading,  setDeleteLoading]  = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/app/api/auth/me', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/events/attending', { credentials: 'include' }).then(r => r.ok ? r.json() : { attendances: [] }),
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([data, attended, memberships]) => {
      if (!data?.id) return
      const parts = (data.name ?? '').trim().split(' ')
      setForm({
        firstName:    parts[0] ?? '',
        lastName:     parts.slice(1).join(' ') ?? '',
        bio:          data.bio          ?? '',
        neighborhood: data.neighborhood ?? '',
        instagram:    data.instagram    ?? '',
        linkedin:     data.linkedin     ?? '',
        phone:        data.phone        ?? '',
        gender:       data.gender       ?? '',
        nationality:  data.nationality  ?? '',
        color:        data.color        ?? '#f59e0b',
        profilePhoto: data.profilePhoto ?? '',
        languages:         Array.isArray(data.languages)  ? data.languages  : [],
        interests:         Array.isArray(data.interests)    ? data.interests    : [],
        socialStyles:      Array.isArray(data.socialStyles) ? data.socialStyles : [],
        lookingFor:        Array.isArray(data.lookingFor)   ? data.lookingFor   : [],
        profileVisibility: data.profileVisibility ?? 'everyone',
        industry:           data.industry           ?? '',
        professionalRole:   data.professionalRole   ?? '',
        professionalStatus: data.professionalStatus ?? '',
      })
      const eventCount = Array.isArray(attended?.attendances)
        ? attended.attendances.length
        : (Array.isArray(attended) ? attended.length : 0)
      const clubCount  = Array.isArray(memberships) ? memberships.length : 0
      setStats({ events: eventCount, clubs: clubCount, joinedAt: data.joinedAt })
    }).finally(() => setLoading(false))
  }, [])

  function set(key: string, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handlePhotoUpload(file: File) {
    setPhotoUploading(true)
    try {
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'users')
      const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Upload failed'); return }
      set('profilePhoto', data.url)
      await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePhoto: data.url }),
      })
      setUser({ ...user, profilePhoto: data.url })
      toast.success('Photo updated')
    } catch { toast.error('Upload failed') }
    finally { setPhotoUploading(false) }
  }

  async function handleSave() {
    if (!form.firstName.trim()) { toast.error('First name is required'); return }
    setSaving(true)
    try {
      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
      // Exclude firstName/lastName (merged into name) and profilePhoto (managed by upload button)
      const { firstName, lastName, profilePhoto, ...rest } = form
      // Empty professional fields go to null so the column is cleared
      // and the Pro directory filter can distinguish "unset" from
      // "set to social_only".
      const payload: Record<string, unknown> = { ...rest, name: fullName }
      if (rest.industry           === '') payload.industry           = null
      if (rest.professionalRole   === '') payload.professionalRole   = null
      if (rest.professionalStatus === '') payload.professionalStatus = null
      const res = await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { toast.error('Failed to save'); return }
      const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      setUser({ ...user, name: fullName, initials, color: form.color, bio: form.bio, neighborhood: form.neighborhood, instagram: form.instagram, profilePhoto: form.profilePhoto || undefined })
      toast.success('Profile saved')
    } catch { toast.error('Something went wrong') }
    finally { setSaving(false) }
  }

  async function handleChangePassword() {
    setPwError('')
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) { setPwError('All fields are required'); return }
    if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match'); return }
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters'); return }
    setPwLoading(true)
    try {
      const res = await fetch('/app/api/auth/change-password', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      })
      const data = await res.json()
      if (!res.ok) { setPwError(data.error ?? 'Failed'); return }
      setPwForm({ current: '', next: '', confirm: '' })
      toast.success('Password changed')
    } catch { setPwError('Something went wrong') }
    finally { setPwLoading(false) }
  }

  async function handleDeleteAccount() {
    setDeleteError('')
    if (!deletePassword) { setDeleteError('Password is required'); return }
    setDeleteLoading(true)
    try {
      const res = await fetch('/app/api/auth/delete-account', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      })
      const data = await res.json()
      if (!res.ok) { setDeleteError(data.error ?? 'Failed'); setDeleteLoading(false); return }
      router.push('/login')
    } catch { setDeleteError('Something went wrong'); setDeleteLoading(false) }
  }

  async function handleEmailChange() {
    setEmailError('')
    if (!newEmail.trim()) { setEmailError('Email is required'); return }
    if (!emailPassword) { setEmailError('Password is required'); return }
    setEmailLoading(true)
    try {
      const res = await fetch('/app/api/auth/update-email', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: emailPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setEmailError(data.error ?? 'Failed'); return }
      setNewEmail(''); setEmailPassword('')
      toast.success('Email updated — check your inbox to verify')
    } catch { setEmailError('Something went wrong') }
    finally { setEmailLoading(false) }
  }

  const fullName = `${form.firstName} ${form.lastName}`.trim()
  const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || user.initials

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">

      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
            {/* Avatar */}
            <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}
              className="relative w-24 h-24 sm:w-20 sm:h-20 rounded-2xl shrink-0 overflow-hidden group focus:outline-none">
              {form.profilePhoto ? (
                <img src={resolveImageUrl(form.profilePhoto)} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-3xl sm:text-2xl font-bold"
                  style={{ backgroundColor: form.color }}>{initials}</div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center">
                {photoUploading
                  ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                }
              </div>
            </button>
            <input ref={photoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f) }} />

            <div className="flex-1 min-w-0 text-center sm:text-left">
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{fullName || user.name}</h1>
              <p className="text-sm text-gray-600 mt-0.5 truncate">{user.email}</p>
              {stats && (
                <div className="flex items-center justify-center sm:justify-start flex-wrap gap-x-4 gap-y-1 mt-2">
                  <span className="text-xs text-gray-600"><span className="font-bold text-gray-900">{stats.events}</span> events</span>
                  <span className="text-xs text-gray-600"><span className="font-bold text-gray-900">{stats.clubs}</span> clubs</span>
                  <span className="text-xs text-gray-600">Since <span className="font-bold text-gray-900">{new Date(stats.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span></span>
                </div>
              )}
              <button onClick={() => photoInputRef.current?.click()}
                className="mt-2 text-xs text-amber-600 font-medium sm:hidden">
                {form.profilePhoto ? 'Change photo' : 'Upload photo'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading ? (
          <SkeletonList rows={4} />
        ) : (
          <>
            {/* ── Basic info ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
              <h2 className="font-bold text-gray-900">Basic info</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">First name</label>
                  <input type="text" value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Ayşe" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Last name</label>
                  <input type="text" value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Kaya" className={inputCls} />
                </div>
                <div className="col-span-full">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Bio <span className="font-normal text-gray-400">{form.bio.length}/1000</span>
                  </label>
                  <textarea rows={5} value={form.bio} onChange={e => set('bio', e.target.value)}
                    placeholder="Tell the community a bit about yourself…" maxLength={1000}
                    className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Gender</label>
                  <select value={form.gender} onChange={e => set('gender', e.target.value)} className={`${inputCls} bg-white`}>
                    <option value="">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nationality</label>
                  <select value={form.nationality} onChange={e => set('nationality', e.target.value)} className={inputCls}>
                    <option value="">Select country…</option>
                    {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-full">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Neighborhood</label>
                  <select value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone</label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+90 555 000 0000" className={inputCls} />
                </div>
              </div>

              {/* Avatar color */}
              {!form.profilePhoto && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">Avatar colour</label>
                  <div className="flex gap-2 flex-wrap">
                    {AVATAR_COLORS.map(c => (
                      <button key={c} onClick={() => set('color', c)}
                        className={`w-8 h-8 rounded-full border-2 transition-transform ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Social ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
              <h2 className="font-bold text-gray-900">Social</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Instagram</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                    <input type="text" value={form.instagram.replace('@', '')} onChange={e => set('instagram', e.target.value)}
                      placeholder="username" className={`${inputCls} pl-7`} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">LinkedIn</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">in/</span>
                    <input type="text" value={form.linkedin.replace(/.*linkedin\.com\/in\//i, '')} onChange={e => set('linkedin', e.target.value)}
                      placeholder="your-name" className={`${inputCls} pl-8`} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Languages ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Languages</h2>
              <p className="text-xs text-gray-400">Select all languages you speak.</p>
              <TagPicker
                options={COMMON_LANGUAGES}
                selected={form.languages}
                onChange={v => set('languages', v)}
              />
            </div>

            {/* ── Interests ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Interests</h2>
              <p className="text-xs text-gray-400">What are you into? Helps you find like-minded people.</p>
              <TagPicker
                options={COMMON_INTERESTS}
                selected={form.interests}
                onChange={v => set('interests', v)}
                max={12}
              />
            </div>

            {/* ── Social Style ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Social Style</h2>
              <p className="text-xs text-gray-400">How do you show up socially? Pick up to 3 that fit you best.</p>
              <div className="flex flex-wrap gap-2">
                {SOCIAL_STYLES.map(s => {
                  const active = form.socialStyles.includes(s.id)
                  return (
                    <button key={s.id} type="button"
                      onClick={() => {
                        const cur = form.socialStyles
                        if (active) set('socialStyles', cur.filter(x => x !== s.id))
                        else if (cur.length < 3) set('socialStyles', [...cur, s.id])
                      }}
                      title={s.desc}
                      className={`text-sm px-4 py-2 rounded-full font-medium transition-colors ${
                        active
                          ? 'bg-amber-500 text-white'
                          : !active && form.socialStyles.length >= 3
                            ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {s.label}
                    </button>
                  )
                })}
              </div>
              {form.socialStyles.length >= 3 && (
                <p className="text-xs text-amber-600">Maximum 3 selected. Remove one to change.</p>
              )}
            </div>

            {/* ── Professional ── opt-in surface that powers the
                upcoming Pro directory filter without mixing into the
                social feed. Wrapped in a subtle dark accent so it
                visually signals "different mode" than the warm cards
                above it. */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-bold text-gray-900">Professional</h2>
                    <span className="text-[10px] font-extrabold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0">Optional</span>
                  </div>
                  <p className="text-xs text-gray-400">Helps members find you for work conversations. Stays out of your social profile.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Industry</label>
                  <select value={form.industry} onChange={e => set('industry', e.target.value)} className={inputCls}>
                    <option value="">— Pick one —</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Role</label>
                  <input type="text" maxLength={60}
                    value={form.professionalRole}
                    onChange={e => set('professionalRole', e.target.value)}
                    placeholder="e.g. Founder, Designer, Lawyer"
                    className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Status</label>
                <div className="flex flex-wrap gap-2">
                  {PROFESSIONAL_STATUS_OPTIONS.map(opt => {
                    const active = form.professionalStatus === opt.id
                    return (
                      <button key={opt.id} type="button"
                        onClick={() => set('professionalStatus', active ? '' : opt.id)}
                        className={`text-sm px-4 py-2 rounded-full font-medium transition-colors ${
                          active ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {form.professionalStatus === 'social_only'
                    ? 'You won\'t appear in professional searches. Your industry and role stay hidden.'
                    : form.professionalStatus
                      ? 'Members searching the Pro directory can find you under your industry and role.'
                      : 'Pick one to make your industry and role discoverable. Skip to keep your profile social-only.'}
                </p>
              </div>

              {/* Pro funnel nudge — closes the loop on why these fields
                  matter. Visible to every member filling in the section
                  (including those who already joined the Pro waitlist —
                  the share-with-a-friend angle still applies). Designed
                  to feel like a hint, not an ad. */}
              <Link href="/pro"
                className="block bg-gradient-to-br from-zinc-900 to-zinc-950 border border-amber-500/30 rounded-xl p-4 hover:border-amber-400 transition-colors group">
                <div className="flex items-center gap-3">
                  <div aria-hidden="true" className="text-xl shrink-0">🪪</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-amber-400 font-extrabold mb-0.5">Smileys Pro · Coming soon</p>
                    <p className="text-sm font-bold text-white leading-tight">
                      Members will filter the network by industry and role.
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">Founders lock in 50% off forever — reserve your spot.</p>
                  </div>
                  <span className="text-sm font-bold text-amber-400 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
              </Link>
            </div>

            {/* ── Looking for ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Looking for</h2>
              <p className="text-xs text-gray-400">Let others know what kind of connections you're open to.</p>
              <div className="flex flex-wrap gap-2">
                {LOOKING_FOR_OPTIONS.map(opt => (
                  <button key={opt.id} type="button"
                    onClick={() => {
                      const cur = form.lookingFor
                      set('lookingFor', cur.includes(opt.id) ? cur.filter(x => x !== opt.id) : [...cur, opt.id])
                    }}
                    className={`text-sm px-4 py-2 rounded-full font-medium transition-colors ${
                      form.lookingFor.includes(opt.id)
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={saving || !form.firstName.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : 'Save profile'}
            </button>

            {/* ── Notification preferences ── */}
            <Link href="/settings"
              className="flex items-center justify-between bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-amber-200 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Notification preferences</p>
                  <p className="text-xs text-gray-400 mt-0.5">Events, reminders, wall posts, quiet hours</p>
                </div>
              </div>
              <svg className="w-4 h-4 text-gray-300 group-hover:text-amber-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>

            {/* ── Email ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
              <h2 className="font-bold text-gray-900">Email address</h2>
              <p className="text-sm text-gray-600">Current: <span className="font-medium text-gray-800">{user.email}</span>
                {user.emailVerified
                  ? <span className="ml-2 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">Verified</span>
                  : <span className="ml-2 text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full">Unverified</span>}
              </p>
              {emailError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{emailError}</p>}
              <div className="space-y-2">
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="New email address" className={inputCls} />
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <input type={showEmailPw ? 'text' : 'password'} value={emailPassword} onChange={e => setEmailPassword(e.target.value)} placeholder="Confirm with password" className={`${inputCls} w-full pr-12`} />
                    <PasswordToggle visible={showEmailPw} onToggle={() => setShowEmailPw(p => !p)} />
                  </div>
                  <button onClick={handleEmailChange} disabled={emailLoading || !newEmail.trim() || !emailPassword}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                    {emailLoading ? 'Saving…' : 'Update email'}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Password ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
              <h2 className="font-bold text-gray-900">Change password</h2>
              {pwError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{pwError}</p>}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Current password</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} className={`${inputCls} pr-12`} />
                    <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">New password</label>
                    <div className="relative">
                      <input type={showPw ? 'text' : 'password'} value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} className={`${inputCls} pr-12`} />
                      <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm</label>
                    <div className="relative">
                      <input type={showPw ? 'text' : 'password'} value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} className={`${inputCls} pr-12`} />
                      <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={handleChangePassword} disabled={pwLoading}
                className="btn-primary w-full">
                {pwLoading ? 'Saving…' : 'Update password'}
              </button>
            </div>

            {/* ── Privacy ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
              <h2 className="font-bold text-gray-900">Privacy</h2>
              <p className="text-sm text-gray-600">Control who can see your profile in the member directory.</p>
              <div className="space-y-2">
                {([
                  { id: 'everyone',    label: 'Everyone',                   sub: 'All approved members can view your profile'       },
                  { id: 'connections', label: 'Connections only',           sub: 'You still appear in the directory, but your bio, interests, clubs and socials stay locked until someone connects with you' },
                ] as { id: string; label: string; sub: string }[]).map(opt => (
                  <label key={opt.id}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                      form.profileVisibility === opt.id
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}>
                    <input type="radio" name="visibility" value={opt.id} checked={form.profileVisibility === opt.id}
                      onChange={() => set('profileVisibility', opt.id)} className="mt-0.5 accent-amber-500" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="space-y-3 pb-4">
              <button onClick={logout}
                className="w-full py-3 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-xl transition-colors">
                Sign out
              </button>

              {/* Delete account */}
              {!showDeleteConfirm ? (
                <button onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-3 text-gray-400 hover:text-red-500 text-xs font-medium transition-colors">
                  Delete my account
                </button>
              ) : (
                <div className="border border-red-200 rounded-2xl p-5 space-y-3 bg-red-50">
                  <div>
                    <p className="text-sm font-bold text-red-700">Delete account permanently</p>
                    <p className="text-xs text-red-500 mt-1">Your profile and personal data will be erased. This cannot be undone.</p>
                  </div>
                  {deleteError && <p className="text-xs text-red-600 bg-white px-3 py-2 rounded-xl">{deleteError}</p>}
                  <div className="relative">
                    <input type={showDeletePw ? 'text' : 'password'} value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                      placeholder="Enter your password to confirm"
                      className="input input-error pr-12" />
                    <PasswordToggle visible={showDeletePw} onToggle={() => setShowDeletePw(p => !p)} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteError('') }}
                      className="flex-1 py-2.5 border border-gray-200 text-gray-600 hover:bg-white text-sm font-semibold rounded-xl transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleDeleteAccount} disabled={deleteLoading || !deletePassword}
                      className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
                      {deleteLoading ? 'Deleting…' : 'Delete account'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
