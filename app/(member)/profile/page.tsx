'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { resolveImageUrl, getInitials } from '@/lib/data'
import { useCityNeighborhoods } from '@/hooks/useCityNeighborhoods'
import { COUNTRIES } from '@/lib/countries'
import { SkeletonList } from '@/components/Skeleton'
import { downscaleImage } from '@/lib/image-resize'
import PhotoRotateDialog from '@/components/PhotoRotateDialog'
import MembershipBadge from '@/components/MembershipBadge'
import { confirmToast } from '@/lib/confirmToast'

const AVATAR_COLORS = [
  '#f472b6', '#60a5fa', '#fbbf24', '#f87171', '#fb923c',
  '#e879f9', '#34d399', '#a78bfa', '#22d3ee', '#4ade80',
]

// Hoisted to lib/profileOptions — this copy had already drifted from the
// apply form's (different ordering and membership).
import { COMMON_LANGUAGES, LOOKING_FOR_OPTIONS as SHARED_LOOKING_FOR } from '@/lib/profileOptions'
import { SOCIAL_STYLES } from '@/lib/socialStyles'
import { useHomeCity } from '@/hooks/useHomeCity'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'
import { phonePlaceholder } from '@/lib/country'

const COMMON_INTERESTS = [
  'Travel', 'Photography', 'Hiking', 'Yoga', 'Cooking', 'Music',
  'Art', 'Film', 'Reading', 'Fitness', 'Dancing', 'Tech',
  'Entrepreneurship', 'Design', 'Food & Drink', 'Sailing', 'Cycling',
  'Coffee', 'Fashion', 'Gaming', 'Meditation', 'Language Learning',
  'Volunteering', 'Startups', 'Writing', 'Theatre', 'Architecture',
]

const LOOKING_FOR_OPTIONS = SHARED_LOOKING_FOR

// The same closed set /apply writes and PATCH /api/auth/me accepts. The old
// list here had no Non-binary and used "" for "Prefer not to say", so a
// member who answered either on the apply form saw their answer replaced.
const GENDER_OPTIONS = [
  { value: 'female',            label: 'Female' },
  { value: 'male',              label: 'Male' },
  { value: 'non_binary',        label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const COUNTRY_NAMES = new Set(COUNTRIES.map(c => c.name))

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

// Same caps the server enforces on each tag (PATCH /api/auth/me), so the
// picker can't build a list that save then rejects.
const TAG_MAX_ITEMS = 20
const TAG_MAX_CHARS = 50

const inputCls = 'input'
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1.5'

interface ProfileForm {
  firstName:    string
  lastName:     string
  bio:          string
  neighborhood: string
  instagram:    string
  linkedin:     string
  phone:        string
  gender:       string
  nationality:  string
  color:        string
  profilePhoto: string
  languages:    string[]
  interests:    string[]
  socialStyles: string[]
  lookingFor:   string[]
  profileVisibility:   string
  neighborhoodVisible: boolean
  industry:           string
  professionalRole:   string
  professionalStatus: string
}

type ServerUser = Record<string, unknown>

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function formFromUser(data: ServerUser): ProfileForm {
  const parts = str(data.name).trim().split(/\s+/)
  return {
    firstName:    parts[0] ?? '',
    lastName:     parts.slice(1).join(' '),
    bio:          str(data.bio),
    neighborhood: str(data.neighborhood),
    instagram:    str(data.instagram),
    linkedin:     str(data.linkedin),
    phone:        str(data.phone),
    gender:       str(data.gender),
    nationality:  str(data.nationality),
    color:        str(data.color, '#f59e0b') || '#f59e0b',
    profilePhoto: str(data.profilePhoto),
    languages:    strs(data.languages),
    interests:    strs(data.interests),
    socialStyles: strs(data.socialStyles),
    lookingFor:   strs(data.lookingFor),
    profileVisibility:   str(data.profileVisibility, 'everyone') || 'everyone',
    neighborhoodVisible: typeof data.neighborhoodVisible === 'boolean' ? data.neighborhoodVisible : true,
    industry:           str(data.industry),
    professionalRole:   str(data.professionalRole),
    professionalStatus: str(data.professionalStatus),
  }
}

// The fields Save sends. profilePhoto is absent on purpose: the upload and
// remove buttons save it immediately, so it is never "unsaved".
const SAVED_KEYS = [
  'bio', 'neighborhood', 'instagram', 'linkedin', 'phone', 'gender', 'nationality', 'color',
  'languages', 'interests', 'socialStyles', 'lookingFor', 'profileVisibility', 'neighborhoodVisible',
  'industry', 'professionalRole', 'professionalStatus',
] as const satisfies readonly (keyof ProfileForm)[]

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function isDirty(form: ProfileForm, base: ProfileForm): boolean {
  if (form.firstName.trim() !== base.firstName.trim() || form.lastName.trim() !== base.lastName.trim()) return true
  return SAVED_KEYS.some(k => !same(form[k], base[k]))
}

// Only what changed goes to the server. Sending the whole form re-validated
// values the member never touched — a legacy neighbourhood or gender from an
// older vocabulary would fail save for an unrelated edit to their bio.
function buildPatch(form: ProfileForm, base: ProfileForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (form.firstName.trim() !== base.firstName.trim() || form.lastName.trim() !== base.lastName.trim()) {
    patch.name = `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
  }
  for (const k of SAVED_KEYS) {
    if (same(form[k], base[k])) continue
    // Empty professional fields go to null so the column is cleared and the
    // Pro directory filter can distinguish "unset" from "set to social_only".
    if ((k === 'industry' || k === 'professionalRole' || k === 'professionalStatus') && form[k] === '') patch[k] = null
    else patch[k] = typeof form[k] === 'string' ? (form[k] as string).trim() : form[k]
  }
  return patch
}

function TagPicker({ options, selected, onChange, max, label }: {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  max?: number
  label: string
}) {
  const [custom, setCustom] = useState('')
  const cap = Math.min(max ?? TAG_MAX_ITEMS, TAG_MAX_ITEMS)
  function toggle(item: string) {
    if (selected.includes(item)) {
      onChange(selected.filter(s => s !== item))
    } else {
      if (selected.length >= cap) return
      onChange([...selected, item])
    }
  }
  function addCustom() {
    const v = custom.trim().slice(0, TAG_MAX_CHARS)
    if (!v || selected.includes(v)) { setCustom(''); return }
    if (selected.length >= cap) return
    onChange([...selected, v])
    setCustom('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button key={opt} type="button" onClick={() => toggle(opt)} aria-pressed={selected.includes(opt)}
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
          aria-label={`Add a custom ${label}`}
          maxLength={TAG_MAX_CHARS}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button type="button" onClick={addCustom} className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-medium transition-colors">
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.filter(s => !options.includes(s)).map(s => (
            <span key={s} className="flex items-center gap-1 text-xs bg-amber-500 text-white px-2.5 py-1 rounded-full max-w-full break-words">
              {s}
              <button type="button" onClick={() => onChange(selected.filter(x => x !== s))}
                aria-label={`Remove ${s}`} className="ml-0.5 hover:opacity-70">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth()
  // The member's own city, not the browsed one: the server checks a saved
  // neighbourhood against the home city, and the phone hint is that
  // country's. Passing null until it resolves keeps the picker from flashing
  // the browsed city's list first.
  const { home } = useHomeCity()
  const neighborhoods = useCityNeighborhoods(home?.slug ?? null)

  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [stats,     setStats]     = useState<{ eventsAttended: number; clubs: number } | null>(null)
  const [joinedAt,  setJoinedAt]  = useState<string | null>(null)

  const [form, setForm] = useState<ProfileForm>(() => formFromUser({ color: user.color }))
  // What the server last said. Dirty state is the form measured against
  // this, and a save refreshes both from the response.
  const [baseline, setBaseline] = useState<ProfileForm>(form)
  const serverUser = useRef<ServerUser>({})

  const [photoUploading, setPhotoUploading] = useState(false)
  // The picked file waits here while the member confirms which way is up.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const ready = !loading && !loadError
  const dirty = ready && isDirty(form, baseline)
  const { confirmLeave } = useUnsavedChangesGuard(dirty)

  const applyServerUser = useCallback((data: ServerUser) => {
    serverUser.current = data
    const f = formFromUser(data)
    setForm(f)
    setBaseline(f)
  }, [])

  // A failed load must not fall through to an empty form: saving that would
  // have written blanks over the member's real profile. So a failure shows
  // an error with Retry and no form at all.
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res  = await fetch('/app/api/auth/me?stats=1', { credentials: 'include', cache: 'no-store' })
      const data = res.ok ? await res.json() : null
      if (!data?.id) throw new Error('profile unavailable')
      applyServerUser(data)
      setJoinedAt(typeof data.joinedAt === 'string' ? data.joinedAt : null)
      // Counted server-side: events actually attended (no no-shows, pending
      // or cancelled seats) and approved memberships in active clubs. The
      // lengths of the attending/memberships lists counted neither honestly.
      const s = data.stats
      setStats(s && typeof s.eventsAttended === 'number' && typeof s.clubs === 'number'
        ? { eventsAttended: s.eventsAttended, clubs: s.clubs }
        : null)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [applyServerUser])

  useEffect(() => { load() }, [load])

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // The photo is saved on its own, so keep the form, the baseline and the
  // signed-in user in step without touching any other unsaved edits.
  function commitPhoto(photo: string) {
    serverUser.current = { ...serverUser.current, profilePhoto: photo || null }
    setForm(f => ({ ...f, profilePhoto: photo }))
    setBaseline(b => ({ ...b, profilePhoto: photo }))
    setUser({ ...user, profilePhoto: photo || undefined })
  }

  async function handlePhotoUpload(file: File): Promise<boolean> {
    setPhotoUploading(true)
    try {
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'users')
      const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) { toast.error(data?.error ?? 'Upload failed'); return false }
      // The upload alone changes nothing — only this PATCH points the
      // profile at the new file. Until it succeeds, the old photo stands.
      const saveRes = await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePhoto: data.url }),
      })
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => null)
        toast.error(err?.error ?? 'Could not save your photo — try again')
        return false
      }
      commitPhoto(data.url)
      toast.success('Photo updated')
      return true
    } catch { toast.error('Upload failed'); return false }
    finally { setPhotoUploading(false) }
  }

  async function handleRemovePhoto() {
    if (!(await confirmToast('Remove your profile photo?', { confirmLabel: 'Remove' }))) return
    setPhotoUploading(true)
    try {
      const res = await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePhoto: null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast.error(err?.error ?? 'Could not remove your photo — try again')
        return
      }
      commitPhoto('')
      toast.success('Photo removed')
    } catch { toast.error('Could not remove your photo — try again') }
    finally { setPhotoUploading(false) }
  }

  async function handleSave() {
    if (!form.firstName.trim()) { toast.error('First name is required'); return }
    if (!form.lastName.trim())  { toast.error('Last name is required'); return }
    if (!form.nationality)      { toast.error('Nationality is required'); return }
    if (!form.phone.trim())     { toast.error('Phone number is required'); return }
    const payload = buildPatch(form, baseline)
    if (Object.keys(payload).length === 0) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? 'Failed to save')
        return
      }
      // The response carries what was actually stored — the name after
      // formatName, Instagram reduced to a handle — so the form shows that
      // rather than what was typed. Merged over the last snapshot in case the
      // response carries only some fields.
      const savedFields = body && typeof body === 'object' ? (body.user ?? body) : null
      const next: ServerUser = savedFields && typeof savedFields.name === 'string'
        ? { ...serverUser.current, ...savedFields }
        : { ...serverUser.current, ...payload }
      applyServerUser(next)
      const saved = formFromUser(next)
      const name  = `${saved.firstName} ${saved.lastName}`.trim()
      setUser({
        ...user, name, initials: getInitials(name), color: saved.color, bio: saved.bio,
        neighborhood: saved.neighborhood, instagram: saved.instagram,
        profilePhoto: saved.profilePhoto || undefined,
      })
      toast.success('Profile saved')
    } catch { toast.error('Something went wrong') }
    finally { setSaving(false) }
  }

  const fullName = `${form.firstName} ${form.lastName}`.trim()
  const initials = getInitials(fullName) || user.initials

  const genderOptions = form.gender && !GENDER_OPTIONS.some(o => o.value === form.gender)
    ? [...GENDER_OPTIONS, { value: form.gender, label: `${form.gender.charAt(0).toUpperCase()}${form.gender.slice(1).replace(/_/g, ' ')} (current)` }]
    : GENDER_OPTIONS
  // A stored value the list doesn't carry is still the member's answer.
  // Without its own option the browser selects the first entry instead —
  // "Afghanistan" for nationality, "Select…" for a neighbourhood — and the
  // next save would quietly change it.
  const nationalityIsListed = COUNTRY_NAMES.has(form.nationality)
  const neighborhoodOptions = form.neighborhood && !neighborhoods.includes(form.neighborhood)
    ? [form.neighborhood, ...neighborhoods]
    : neighborhoods

  return (
    <div className={`min-h-screen bg-warm ${dirty ? 'pb-44 md:pb-24' : 'pb-24 md:pb-0'}`}>

      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
            {/* Avatar */}
            <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoUploading || !ready}
              aria-label={form.profilePhoto ? 'Change profile photo' : 'Upload profile photo'}
              className="relative w-24 h-24 sm:w-20 sm:h-20 rounded-2xl shrink-0 overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              {form.profilePhoto ? (
                <img src={resolveImageUrl(form.profilePhoto)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-3xl sm:text-2xl font-bold"
                  style={{ backgroundColor: form.color }}>{initials}</div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center">
                {photoUploading
                  ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <svg aria-hidden="true" className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                }
              </div>
            </button>
            <input ref={photoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
              aria-label="Choose a profile photo"
              onChange={e => {
                const f = e.target.files?.[0]
                // Clear the input so picking the SAME file again still fires
                // onChange — otherwise a cancelled rotate cannot be retried.
                e.target.value = ''
                if (f) setPendingPhoto(f)
              }} />

            {pendingPhoto && (
              <PhotoRotateDialog
                file={pendingPhoto}
                busy={photoUploading}
                onCancel={() => setPendingPhoto(null)}
                onConfirm={async f => { if (await handlePhotoUpload(f)) setPendingPhoto(null) }}
              />
            )}

            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 min-w-0 max-w-full break-words">{fullName || user.name}</h1>
                <MembershipBadge membershipType={user.membershipType} className="text-xs px-2.5 py-1" />
              </div>
              <p className="text-sm text-gray-600 mt-0.5 truncate">{user.email}</p>
              {ready && (stats || joinedAt) && (
                <div className="flex items-center justify-center sm:justify-start flex-wrap gap-x-4 gap-y-1 mt-2">
                  {stats && (
                    <>
                      <span className="text-xs text-gray-600"><span className="font-bold text-gray-900">{stats.eventsAttended}</span> {stats.eventsAttended === 1 ? 'event attended' : 'events attended'}</span>
                      <span className="text-xs text-gray-600"><span className="font-bold text-gray-900">{stats.clubs}</span> {stats.clubs === 1 ? 'club' : 'clubs'}</span>
                    </>
                  )}
                  {joinedAt && (
                    <span className="text-xs text-gray-600">Since <span className="font-bold text-gray-900">{new Date(joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span></span>
                  )}
                </div>
              )}
              {ready && (
                <div className="mt-2 flex items-center justify-center sm:justify-start gap-4">
                  <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}
                    className="text-xs text-amber-600 font-medium sm:hidden disabled:opacity-50">
                    {form.profilePhoto ? 'Change photo' : 'Upload photo'}
                  </button>
                  {form.profilePhoto && (
                    <button type="button" onClick={handleRemovePhoto} disabled={photoUploading}
                      className="text-xs text-gray-500 hover:text-red-600 font-medium disabled:opacity-50">
                      Remove photo
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading ? (
          <SkeletonList rows={4} />
        ) : loadError ? (
          <div role="alert" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center space-y-3">
            <p className="text-sm font-semibold text-gray-900">We couldn&apos;t load your profile.</p>
            <p className="text-xs text-gray-500">Nothing has been changed. Check your connection and try again.</p>
            <button type="button" onClick={load}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* ── Basic info ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
              <h2 className="font-bold text-gray-900">Basic info</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pf-first-name" className={labelCls}>First name <span className="text-red-400">*</span></label>
                  <input id="pf-first-name" type="text" value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Ayşe" autoComplete="given-name" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="pf-last-name" className={labelCls}>Last name <span className="text-red-400">*</span></label>
                  <input id="pf-last-name" type="text" value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Kaya" autoComplete="family-name" className={inputCls} />
                </div>
                <div className="col-span-full">
                  <label htmlFor="pf-bio" className={labelCls}>
                    Bio <span className="font-normal text-gray-400">{form.bio.length}/1000</span>
                  </label>
                  <textarea id="pf-bio" rows={5} value={form.bio} onChange={e => set('bio', e.target.value)}
                    placeholder="Tell the community a bit about yourself…" maxLength={1000}
                    className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label htmlFor="pf-gender" className={labelCls}>Gender</label>
                  <select id="pf-gender" value={form.gender} onChange={e => set('gender', e.target.value)} className={`${inputCls} bg-white`}>
                    <option value="" disabled>Select…</option>
                    {genderOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="pf-nationality" className={labelCls}>Nationality <span className="text-red-400">*</span></label>
                  <select id="pf-nationality" value={form.nationality} onChange={e => set('nationality', e.target.value)} className={inputCls}
                    aria-describedby="pf-nationality-hint">
                    <option value="" disabled>Select your nationality…</option>
                    {form.nationality && !nationalityIsListed && (
                      <option value={form.nationality}>{form.nationality} (current)</option>
                    )}
                    {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
                  </select>
                  {/* Same hint as the apply form: the answer used to be labelled
                      "Country" there, so members who picked where they live can
                      correct themselves here. */}
                  <p id="pf-nationality-hint" className="text-xs text-gray-500 mt-1">Where you&apos;re from — not where you live now.</p>
                </div>
                <div className="col-span-full">
                  <label htmlFor="pf-neighborhood" className={labelCls}>
                    Neighborhood{home?.name ? <span className="font-normal text-gray-400"> in {home.name}</span> : null}
                  </label>
                  <select id="pf-neighborhood" value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {neighborhoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="pf-phone" className={labelCls}>Phone <span className="text-red-400">*</span></label>
                  <input id="pf-phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder={phonePlaceholder(home?.country)} autoComplete="tel" maxLength={30} className={inputCls} />
                </div>
              </div>

              {/* Avatar color */}
              {!form.profilePhoto && (
                <div role="group" aria-labelledby="pf-colour-label">
                  <p id="pf-colour-label" className="block text-xs font-semibold text-gray-600 mb-2">Avatar colour</p>
                  <div className="flex gap-2 flex-wrap">
                    {AVATAR_COLORS.map((c, i) => (
                      <button key={c} type="button" onClick={() => set('color', c)}
                        aria-label={`Colour ${i + 1} (${c})`} aria-pressed={form.color === c}
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
              {/* Both fields show exactly what is stored. The LinkedIn one used
                  to hide everything up to "linkedin.com/in/", so a saved share
                  URL (…/in/name?utm=…) looked like a clean slug that the member
                  couldn't see to fix. The server reduces Instagram links to a
                  handle; LinkedIn takes a URL or a bare slug. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pf-instagram" className={labelCls}>Instagram</label>
                  <input id="pf-instagram" type="text" value={form.instagram} onChange={e => set('instagram', e.target.value)}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={100}
                    placeholder="@username or profile link" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="pf-linkedin" className={labelCls}>LinkedIn</label>
                  <input id="pf-linkedin" type="text" value={form.linkedin} onChange={e => set('linkedin', e.target.value)}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={200}
                    placeholder="linkedin.com/in/your-name or your-name" className={inputCls} />
                </div>
              </div>
              <p className="text-xs text-gray-400">Only your connections see these.</p>
            </div>

            {/* ── Languages ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Languages</h2>
              <p className="text-xs text-gray-400">Select all languages you speak.</p>
              <TagPicker
                label="language"
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
                label="interest"
                options={COMMON_INTERESTS}
                selected={form.interests}
                onChange={v => set('interests', v)}
                max={12}
              />
            </div>

            {/* ── Social Style ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Social Style</h2>
              <p className="text-xs text-gray-400">How do you show up socially? Pick up to 3 that fit you best. They show on your profile.</p>
              <div className="flex flex-wrap gap-2">
                {SOCIAL_STYLES.map(s => {
                  const active = form.socialStyles.includes(s.id)
                  return (
                    <button key={s.id} type="button" aria-pressed={active}
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
                  {/* Role and status do render on the profile — for
                      connections — so the old "stays out of your social
                      profile" was a promise the page didn't keep. */}
                  <p className="text-xs text-gray-400">Helps members find you for work conversations. Your role, industry and status show on your profile to your connections.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pf-industry" className={labelCls}>Industry</label>
                  <select id="pf-industry" value={form.industry} onChange={e => set('industry', e.target.value)} className={inputCls}>
                    <option value="">— Pick one —</option>
                    {form.industry && !INDUSTRIES.includes(form.industry) && (
                      <option value={form.industry}>{form.industry} (current)</option>
                    )}
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="pf-role" className={labelCls}>Role</label>
                  <input id="pf-role" type="text" maxLength={60}
                    value={form.professionalRole}
                    onChange={e => set('professionalRole', e.target.value)}
                    placeholder="e.g. Founder, Designer, Lawyer"
                    className={inputCls} />
                </div>
              </div>

              <div role="group" aria-labelledby="pf-status-label">
                <p id="pf-status-label" className="block text-xs font-semibold text-gray-600 mb-2">Status</p>
                <div className="flex flex-wrap gap-2">
                  {PROFESSIONAL_STATUS_OPTIONS.map(opt => {
                    const active = form.professionalStatus === opt.id
                    return (
                      <button key={opt.id} type="button" aria-pressed={active}
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
                  <span aria-hidden="true" className="text-sm font-bold text-amber-400 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
              </Link>
            </div>

            {/* ── Looking for ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="font-bold text-gray-900">Looking for</h2>
              <p className="text-xs text-gray-400">Let others know what kind of connections you&apos;re open to.</p>
              <div className="flex flex-wrap gap-2">
                {LOOKING_FOR_OPTIONS.map(opt => (
                  <button key={opt.id} type="button" aria-pressed={form.lookingFor.includes(opt.id)}
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

            {/* ── Privacy ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
              <h2 className="font-bold text-gray-900">Privacy</h2>
              <p className="text-sm text-gray-600">Control who can see your profile in the member directory.</p>
              {user.isClubHost && (
                <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                  As a host, your profile stays visible to everyone so members can find the people running events and clubs.
                </p>
              )}
              <div className="space-y-2">
                {([
                  { id: 'everyone',    label: 'Everyone',         sub: 'Members can see your name, photo, bio and interests; your Instagram and LinkedIn are for connections only.' },
                  { id: 'connections', label: 'Connections only', sub: 'Other members see just your first name until you connect.' },
                ] as { id: string; label: string; sub: string }[]).filter(opt => !user.isClubHost || opt.id === 'everyone').map(opt => (
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

              {/* Neighborhood discovery is a separate axis from directory
                  visibility: someone can be happy to appear in the directory
                  and still not want to be listed as "near you" on a page
                  organised by where they live. Only narrows — a
                  'connections only' profile stays restricted either way. */}
              <div className="pt-4 border-t border-gray-100">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.neighborhoodVisible}
                    onChange={e => set('neighborhoodVisible', e.target.checked)}
                    className="mt-0.5 accent-amber-500 w-4 h-4" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">
                      Show me to members in my neighborhood
                    </span>
                    <span className="block text-xs text-gray-400 mt-0.5">
                      Lists you under “People around you” on the Neighborhoods page
                      {form.neighborhood ? ` for ${form.neighborhood}` : ''}. Your address is never
                      shown — only the neighborhood you picked.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Save — placed after the last editable profile field
                (Privacy) so members editing the lower sections don't
                have to scroll back up to commit their changes. The sticky
                bar below repeats it wherever the member is on the page. */}
            <button type="button" onClick={handleSave} disabled={saving || !dirty || !form.firstName.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : dirty ? 'Save profile' : 'All changes saved'}
            </button>

            {/* ── Settings — below Save on purpose: it leaves the page. ── */}
            <Link href="/settings"
              className="flex items-center justify-between bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-amber-200 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <svg aria-hidden="true" className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Settings &amp; account</p>
                  <p className="text-xs text-gray-400 mt-0.5">Notifications, password, email, devices, delete account</p>
                </div>
              </div>
              <svg aria-hidden="true" className="w-4 h-4 text-gray-300 group-hover:text-amber-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>

            {/* ── Actions ── */}
            <div className="space-y-3 pb-4">
              <button type="button" onClick={async () => { if (await confirmLeave()) logout() }}
                className="w-full py-3 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-xl transition-colors">
                Sign out
              </button>
            </div>
          </>
        )}
      </div>

      {/* Sticky save bar — only while something is unsaved. It sits above
          the mobile bottom nav (4rem plus the safe area) and at the very
          bottom on desktop, so Save is reachable from any section instead
          of only after the last one. */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <p className="flex-1 min-w-0 text-sm font-medium text-gray-700 truncate">Unsaved changes</p>
            <button type="button" onClick={() => setForm(baseline)} disabled={saving}
              className="px-3 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 disabled:opacity-50">
              Discard
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !form.firstName.trim()}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
