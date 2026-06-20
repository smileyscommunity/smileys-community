'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { isSafeHref } from '@/lib/safeUrl'
import { BUSINESS_CATEGORIES, DIRECTORY_LIMITS, parseGoogleMapsUrl } from '@/lib/directory-constants'
import { DAY_KEYS, DAY_LABELS } from '@/lib/businessHours'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { downscaleImage } from '@/lib/image-resize'

// Small reusable upload widget used inline next to the Logo and Cover
// image URL inputs on both the admin edit drawer and the admin create
// form. Click → file picker → POST /api/upload?folder=directory →
// fills the URL field on success. The folder is admin/moderator-only
// at the upload route layer.
// Controlled Maps-URL paste field. Local state holds the raw text so
// the input is a proper React-controlled input (no e.target.value
// mutation), and parsing runs on every change but the failure-toast
// fires only on blur — so the user can type/paste freely without
// being yelled at mid-word.
function MapsUrlInput({
  onParsed, className,
}: {
  onParsed: (coords: { lat: number; lon: number }) => void
  className?: string
}) {
  const [value, setValue] = useState('')

  function attemptParse(text: string, fireErrorToast: boolean): boolean {
    if (!text.trim()) return false
    const parsed = parseGoogleMapsUrl(text)
    if (parsed) {
      onParsed(parsed)
      toast.success(`Coords filled: ${parsed.lat.toFixed(4)}, ${parsed.lon.toFixed(4)}`)
      setValue('')
      return true
    }
    if (fireErrorToast && /^https?:\/\//.test(text.trim())) {
      // Only warn when the text is clearly URL-shaped — silent for
      // partial typing.
      toast.error('No coordinates in that URL — open the desktop Maps link and copy from the address bar')
    }
    return false
  }

  return (
    <input
      type="text"
      value={value}
      onChange={e => {
        const next = e.target.value
        setValue(next)
        // Try to parse silently on every change so a successful paste
        // auto-fills without needing to blur first.
        attemptParse(next, /* fireErrorToast */ false)
      }}
      onBlur={() => attemptParse(value, /* fireErrorToast */ true)}
      placeholder="https://www.google.com/maps/place/…/@41.0345,28.9817,17z/…"
      className={className}
    />
  )
}

function UploadButton({
  onUploaded, label = 'Upload',
}: {
  onUploaded: (url: string) => void
  label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    try {
      const uploadFile = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file',   uploadFile)
      fd.append('folder', 'directory')
      const r = await fetch('/app/api/upload', { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Upload failed'); return }
      onUploaded(d.url)
      toast.success('Image uploaded')
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="text-[10px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
      >
        {busy ? '…' : `📤 ${label}`}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
      />
    </>
  )
}

type View = 'approved' | 'pending' | 'rejected' | 'claims' | 'reports'

const EMPTY_CREATE = {
  name: '', category: '', description: '',
  neighborhood: '', address: '', phone: '',
  website: '', instagram: '', languages: '',
  logo: '', coverImage: '',
  isExpatOwned: false, isExpatFriendly: false,
}
type CreateForm = typeof EMPTY_CREATE

// Example JSON shown in the bulk-paste box. Keeps users from having to
// guess the field names. Pasting JSON that omits optional fields is fine
// — the server validates per-field.
const BULK_TEMPLATE = JSON.stringify([
  {
    name: 'Simit & Coffee Co.',
    category: 'Cafe',
    description: 'Specialty third-wave coffee + simit, English-speaking baristas.',
    neighborhood: 'Kadıköy',
    website: 'https://example.com',
    instagram: 'simit_coffee',
    isExpatFriendly: true,
  },
], null, 2)

interface BusinessUser { id: string; name: string; email: string }
interface Business {
  id: string
  name: string
  category: string
  description: string
  neighborhood: string | null
  address: string | null
  phone: string | null
  website: string | null
  instagram: string | null
  logo: string | null
  coverImage: string | null
  isExpatOwned: boolean
  isExpatFriendly: boolean
  languages: string | null
  latitude:  number | null
  longitude: number | null
  hours: Record<string, string | null> | null
  memberDiscount: string | null
  tags: string[]
  isApproved: boolean
  isActive: boolean
  createdAt: string
  submittedBy: BusinessUser
  reviewedBy: BusinessUser | null
}

type EditFields = {
  name: string
  category: string
  description: string
  neighborhood: string
  address: string
  phone: string
  website: string
  instagram: string
  languages: string
  logo: string
  coverImage: string
  latitude:  string
  longitude: string
  memberDiscount: string
  // Tags entered as a single comma-separated string in the form; the
  // payload sent to the API stays an array (the validator accepts
  // either shape, normalizing to array).
  tagsStr: string
  isExpatOwned: boolean
  isExpatFriendly: boolean
  // Hours kept as a separate object so saving sends an actual JSON
  // shape, not a flat field set. Empty string per day = closed/not set.
  hours: Record<string, string>
}

function toEditFields(b: Business): EditFields {
  return {
    name:            b.name,
    category:        b.category,
    description:     b.description,
    neighborhood:    b.neighborhood    ?? '',
    address:         b.address         ?? '',
    phone:           b.phone           ?? '',
    website:         b.website         ?? '',
    instagram:       b.instagram       ?? '',
    languages:       b.languages       ?? '',
    logo:            b.logo            ?? '',
    coverImage:      b.coverImage      ?? '',
    latitude:        b.latitude  != null ? String(b.latitude)  : '',
    longitude:       b.longitude != null ? String(b.longitude) : '',
    memberDiscount:  b.memberDiscount  ?? '',
    tagsStr:         (b.tags ?? []).join(', '),
    hours:           Object.fromEntries(DAY_KEYS.map(d => [
      d, typeof b.hours?.[d] === 'string' ? b.hours[d]! : '',
    ])),
    isExpatOwned:    b.isExpatOwned,
    isExpatFriendly: b.isExpatFriendly,
  }
}

function BusinessRow({ b, onAction }: { b: Business; onAction: () => void }) {
  const [expanded,      setExpanded]      = useState(false)
  const [loading,       setLoading]       = useState(false)
  // Inline confirm replaces a single-click destructive delete — matches
  // the pattern used everywhere else in /admin.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing,       setEditing]       = useState(false)
  const [edit,          setEdit]          = useState<EditFields>(() => toEditFields(b))

  async function act(action: string) {
    setLoading(true)
    try {
      const r = await fetch('/app/api/admin/directory', {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'delete' ? { id: b.id } : { id: b.id, action }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed')
        return
      }
      toast.success(action === 'approve' ? 'Approved!' : action === 'reject' ? 'Rejected' : action === 'delete' ? 'Deleted' : 'Updated')
      setConfirmDelete(false)
      onAction()
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  function startEdit() {
    setEdit(toEditFields(b))
    setEditing(true)
  }

  function cancelEdit() {
    setEdit(toEditFields(b))
    setEditing(false)
  }

  async function saveEdit() {
    setLoading(true)
    try {
      // Build a diff-only patch — only ship fields whose value changed.
      // The API allowlist is identical to the create normalizer, so
      // anything we don't touch stays untouched on the server.
      const patch: Record<string, unknown> = {}
      const original = toEditFields(b)
      for (const k of Object.keys(edit) as (keyof EditFields)[]) {
        // `hours` is an object — shallow-compare per-day strings, then
        // ship as a {mon: "...", ...} payload. The API turns empty
        // strings into nulls (closed) inside parseHours.
        if (k === 'hours') {
          const changed = DAY_KEYS.some(d => (edit.hours[d] ?? '') !== (original.hours[d] ?? ''))
          if (changed) {
            patch.hours = Object.fromEntries(DAY_KEYS.map(d => [d, edit.hours[d] || null]))
          }
          continue
        }
        // tagsStr is form-only — ship as `tags` (string the validator
        // re-splits) when it changed.
        if (k === 'tagsStr') {
          if (edit.tagsStr !== original.tagsStr) patch.tags = edit.tagsStr
          continue
        }
        if (edit[k] !== original[k]) patch[k] = edit[k]
      }
      if (Object.keys(patch).length === 0) {
        toast.message('Nothing changed')
        setEditing(false)
        return
      }
      const r = await fetch('/app/api/admin/directory', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id, ...patch }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed to save')
        return
      }
      toast.success('Saved')
      setEditing(false)
      onAction()
    } catch {
      toast.error('Network error — not saved')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500'
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1'

  function field<K extends keyof EditFields>(k: K) {
    return { value: edit[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setEdit(s => ({ ...s, [k]: e.target.value } as EditFields)) }
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-white/5 overflow-hidden">
      <button
        onClick={() => setExpanded(s => !s)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <svg className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{b.name}</span>
            <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{b.category}</span>
            {b.isExpatOwned    && <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">Expat-owned</span>}
            {b.isExpatFriendly && <span className="text-[10px] text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full">Expat-friendly</span>}
            {!b.isActive && <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Inactive</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            by {b.submittedBy.name} · {b.neighborhood || 'no neighborhood'} · {new Date(b.createdAt).toLocaleDateString()}
          </p>
        </div>
      </button>

      {expanded && !editing && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          <p className="text-xs text-zinc-300">{b.description}</p>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500">
            {b.address   && <span>📍 {b.address}</span>}
            {b.phone     && <span>📞 {b.phone}</span>}
            {/* Defense-in-depth: only render the website link if its href
                passes the safe-URL allowlist. The API now validates on
                insert + update, but historical rows are untrusted. */}
            {b.website && isSafeHref(b.website) && (
              <a href={b.website} target="_blank" rel="noopener noreferrer nofollow" className="text-amber-400 hover:underline truncate">🌐 Website</a>
            )}
            {b.instagram && /^[A-Za-z0-9._]{1,30}$/.test(b.instagram.replace(/^@/, '')) && (
              <a href={`https://instagram.com/${b.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer nofollow" className="text-pink-400 hover:underline">📸 {b.instagram}</a>
            )}
            {b.languages && <span>🗣 {b.languages}</span>}
          </div>

          <div className="text-xs text-zinc-500">
            Submitted by <span className="text-zinc-300">{b.submittedBy.name}</span> ({b.submittedBy.email})
            {b.reviewedBy && <span> · Reviewed by {b.reviewedBy.name}</span>}
          </div>

          {/* Verification helpers. Prebuilt search URLs for the two
              fastest "does this place exist?" checks — Google Maps
              (locations + reviews) and Google Search (broader hits).
              Both quote the business name so the query treats it as a
              single phrase rather than a loose keyword set. */}
          <div className="flex gap-3 flex-wrap text-xs">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`"${b.name}"${b.neighborhood ? ` ${b.neighborhood}` : ''} Istanbul`)}`}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-emerald-400 hover:text-emerald-300 hover:underline"
            >
              🗺 Verify on Google Maps
            </a>
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(`"${b.name}"${b.neighborhood ? ` ${b.neighborhood}` : ''} Istanbul`)}`}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-blue-400 hover:text-blue-300 hover:underline"
            >
              🔎 Google search
            </a>
          </div>

          <div className="flex gap-2 flex-wrap pt-1">
            <button onClick={startEdit} disabled={loading}
              className="text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              Edit
            </button>
            {/* "Pending" bucket: isApproved=false AND isActive=true. */}
            {!b.isApproved && b.isActive && (
              <>
                <button onClick={() => act('approve')} disabled={loading}
                  className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Approve
                </button>
                <button onClick={() => act('reject')} disabled={loading}
                  className="text-xs font-semibold bg-red-600/80 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Reject
                </button>
              </>
            )}
            {/* "Rejected" bucket — let admin restore back to pending. */}
            {!b.isApproved && !b.isActive && (
              <button onClick={() => act('approve')} disabled={loading}
                className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                Restore &amp; approve
              </button>
            )}
            {b.isApproved && (
              <button onClick={() => act('toggle-active')} disabled={loading}
                className="text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {b.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={() => act('delete')} disabled={loading}
                  className="text-xs font-semibold bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {loading ? '…' : 'Delete?'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={loading}
                className="text-xs font-semibold bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Inline edit form. Renders in place of the read-only details when
          the admin clicks Edit. Saves only the fields that changed (diff
          patch) via PATCH — the API runs the same allowlist validator as
          the public POST / admin create, so a bad URL or unknown category
          is rejected here too. */}
      {expanded && editing && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Name</label>
              <input maxLength={DIRECTORY_LIMITS.name} {...field('name')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select {...field('category')} className={inputCls}>
                {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea maxLength={DIRECTORY_LIMITS.description} rows={3} {...field('description')} className={`${inputCls} resize-none`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Neighborhood</label>
              <select {...field('neighborhood')} className={inputCls}>
                <option value="">—</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Address</label>
              <input maxLength={DIRECTORY_LIMITS.address} {...field('address')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input maxLength={DIRECTORY_LIMITS.phone} placeholder="+90 5xx xxx xx xx" {...field('phone')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Languages</label>
              <input maxLength={DIRECTORY_LIMITS.languages} placeholder="English, Turkish…" {...field('languages')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <input maxLength={DIRECTORY_LIMITS.website} placeholder="https://…" {...field('website')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Instagram</label>
              <input maxLength={DIRECTORY_LIMITS.instagram} placeholder="@handle" {...field('instagram')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Logo URL</label>
              <div className="flex gap-2">
                <input maxLength={DIRECTORY_LIMITS.logo} placeholder="https://…" {...field('logo')} className={inputCls} />
                <UploadButton label="Logo" onUploaded={url => setEdit(s => ({ ...s, logo: url }))} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Cover / Banner URL</label>
              <div className="flex gap-2">
                <input maxLength={DIRECTORY_LIMITS.coverImage} placeholder="https://…" {...field('coverImage')} className={inputCls} />
                <UploadButton label="Banner" onUploaded={url => setEdit(s => ({ ...s, coverImage: url }))} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Paste Google Maps URL</label>
              <MapsUrlInput
                onParsed={({ lat, lon }) => {
                  setEdit(s => ({ ...s, latitude: String(lat), longitude: String(lon) }))
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Latitude</label>
              <input type="text" inputMode="decimal" placeholder="41.0345" {...field('latitude')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Longitude</label>
              <input type="text" inputMode="decimal" placeholder="28.9817" {...field('longitude')} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Smileys member perk</label>
              <input maxLength={DIRECTORY_LIMITS.memberDiscount} placeholder='e.g. "10% off for Smileys members"' {...field('memberDiscount')} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Tags · comma-separated</label>
              <input
                placeholder="Vegan, Brunch, Late-night, Wheelchair accessible"
                value={edit.tagsStr}
                onChange={e => setEdit(s => ({ ...s, tagsStr: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 -mt-1">
            Paste a Google Maps URL above to auto-fill lat/lon, or enter them manually. Blank = pin at neighborhood centroid.
          </p>

          <div>
            <label className={labelCls}>Hours · Mon–Sun</label>
            <p className="text-[10px] text-zinc-500 mb-1.5">
              Format <code>09:00-22:00</code>. Leave blank for closed days. Cross-midnight works (<code>21:00-02:00</code>).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {DAY_KEYS.map(d => (
                <div key={d} className="flex items-center gap-2">
                  <span className="w-9 text-[10px] font-semibold text-zinc-500 uppercase shrink-0">{DAY_LABELS[d]}</span>
                  <input
                    value={edit.hours[d] ?? ''}
                    onChange={e => setEdit(s => ({ ...s, hours: { ...s.hours, [d]: e.target.value } }))}
                    placeholder="09:00-22:00"
                    className={`${inputCls} font-mono`}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={edit.isExpatOwned} onChange={e => setEdit(s => ({ ...s, isExpatOwned: e.target.checked }))} className="accent-amber-500" />
              Expat-owned
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={edit.isExpatFriendly} onChange={e => setEdit(s => ({ ...s, isExpatFriendly: e.target.checked }))} className="accent-teal-500" />
              Expat-friendly
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={saveEdit} disabled={loading}
              className="text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelEdit} disabled={loading}
              className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// --------------- Admin create surface ---------------

type CreateMode = 'single' | 'bulk'

function CreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [mode,    setMode]    = useState<CreateMode>('single')
  const [form,    setForm]    = useState<CreateForm>(EMPTY_CREATE)
  const [bulk,    setBulk]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [report,  setReport]  = useState<{ created: number; failed: number; errors: { index: number; name?: string; error: string }[] } | null>(null)

  function set<K extends keyof CreateForm>(k: K, v: CreateForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function submitSingle(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await fetch('/app/api/admin/directory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business: form }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to create'); return }
      toast.success(`Added "${form.name}" to the directory`)
      setForm(EMPTY_CREATE)
      onCreated()
    } catch {
      toast.error('Network error — not saved')
    } finally {
      setBusy(false)
    }
  }

  async function submitBulk() {
    setBusy(true)
    setReport(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(bulk)
    } catch (e) {
      toast.error('Invalid JSON: ' + (e instanceof Error ? e.message : 'parse error'))
      setBusy(false)
      return
    }
    if (!Array.isArray(parsed)) {
      toast.error('Top-level must be an array of business objects')
      setBusy(false)
      return
    }
    try {
      const r = await fetch('/app/api/admin/directory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businesses: parsed }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to import'); return }
      setReport({ created: d.created ?? 0, failed: d.failed ?? 0, errors: d.errors ?? [] })
      if ((d.created ?? 0) > 0) {
        toast.success(`Imported ${d.created} business${d.created === 1 ? '' : 'es'}${d.failed ? ` (${d.failed} skipped)` : ''}`)
        onCreated()
      } else {
        toast.error('No rows were imported — see error report below')
      }
    } catch {
      toast.error('Network error — not saved')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">Add a business</h2>
        <div className="flex items-center gap-2">
          {/* Mode toggle — keeps both flows on the same panel without
              bouncing between routes. Bulk inherits the same validator
              as single, so a row that fails here would fail there. */}
          <div className="flex bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 text-[11px] font-semibold">
            {(['single', 'bulk'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setReport(null) }}
                className={`px-3 py-1 rounded-md capitalize transition-colors ${
                  mode === m ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}>
                {m === 'single' ? 'Single' : 'Bulk JSON'}
              </button>
            ))}
          </div>
          <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
        </div>
      </div>

      {mode === 'single' ? (
        <form onSubmit={submitSingle} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} maxLength={DIRECTORY_LIMITS.name} className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Category *</label>
              <select value={form.category} onChange={e => set('category', e.target.value)} className={inputCls} required>
                <option value="">Select…</option>
                {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Description *</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} maxLength={DIRECTORY_LIMITS.description} rows={2} className={`${inputCls} resize-none`} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Neighborhood</label>
              <select value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls}>
                <option value="">—</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Address</label>
              <input value={form.address} onChange={e => set('address', e.target.value)} maxLength={DIRECTORY_LIMITS.address} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} maxLength={DIRECTORY_LIMITS.phone} placeholder="+90 5xx xxx xx xx" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Languages</label>
              <input value={form.languages} onChange={e => set('languages', e.target.value)} maxLength={DIRECTORY_LIMITS.languages} placeholder="English, Turkish…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <input value={form.website} onChange={e => set('website', e.target.value)} maxLength={DIRECTORY_LIMITS.website} placeholder="https://…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Instagram handle</label>
              <input value={form.instagram} onChange={e => set('instagram', e.target.value)} maxLength={DIRECTORY_LIMITS.instagram} placeholder="@handle" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Logo URL</label>
              <div className="flex gap-2">
                <input value={form.logo} onChange={e => set('logo', e.target.value)} maxLength={DIRECTORY_LIMITS.logo} placeholder="https://…" className={inputCls} />
                <UploadButton label="Logo" onUploaded={url => set('logo', url)} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Cover / Banner URL</label>
              <div className="flex gap-2">
                <input value={form.coverImage} onChange={e => set('coverImage', e.target.value)} maxLength={DIRECTORY_LIMITS.coverImage} placeholder="https://…" className={inputCls} />
                <UploadButton label="Banner" onUploaded={url => set('coverImage', url)} />
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={form.isExpatOwned} onChange={e => set('isExpatOwned', e.target.checked)} className="accent-amber-500" />
              Expat-owned
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={form.isExpatFriendly} onChange={e => set('isExpatFriendly', e.target.checked)} className="accent-teal-500" />
              Expat-friendly
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={busy}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50">
              {busy ? 'Saving…' : 'Add to directory'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">
            Paste a JSON array of business objects. Each row is validated independently — valid rows are imported, invalid rows are skipped and reported below. Max {200} per request.
          </p>
          <textarea
            value={bulk}
            onChange={e => setBulk(e.target.value)}
            placeholder={BULK_TEMPLATE}
            rows={12}
            spellCheck={false}
            className={`${inputCls} font-mono text-[12px] resize-y`}
          />
          <div className="flex gap-2">
            <button onClick={submitBulk} disabled={busy || !bulk.trim()}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50">
              {busy ? 'Importing…' : 'Import'}
            </button>
            <button onClick={() => setBulk(BULK_TEMPLATE)}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors">
              Insert template
            </button>
          </div>
          {report && (
            <div className="border border-zinc-800 rounded-lg p-3 text-xs space-y-2">
              <div className="text-zinc-300">
                <span className="text-emerald-400 font-semibold">{report.created}</span> imported,{' '}
                <span className={report.failed ? 'text-red-400 font-semibold' : 'text-zinc-500'}>{report.failed}</span> skipped.
              </div>
              {report.errors.length > 0 && (
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {report.errors.map(e => (
                    <li key={e.index} className="text-red-400">
                      Row {e.index + 1}{e.name ? ` "${e.name}"` : ''}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --------------- Claims surface ---------------

interface ClaimRow {
  id: string
  message: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  reviewedAt: string | null
  business: { id: string; name: string; category: string; neighborhood: string | null; claimedById: string | null }
  claimant: { id: string; name: string; email: string }
  reviewedBy: { id: string; name: string } | null
}

function ClaimsList() {
  const [status,  setStatus]  = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [rows,    setRows]    = useState<ClaimRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/app/api/admin/directory/claims?status=${status}`, { credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || `Couldn't load claims (HTTP ${r.status})`)
        setRows([])
        return
      }
      const d = await r.json()
      setRows(Array.isArray(d) ? d : [])
    } catch {
      toast.error('Network error — could not load claims')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    setActing(id)
    try {
      const r = await fetch(`/app/api/admin/directory/claims/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed')
        return
      }
      toast.success(action === 'approve' ? 'Claim approved' : 'Claim rejected')
      load()
    } catch {
      toast.error('Network error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-zinc-900 p-1 rounded-xl w-fit">
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`text-xs font-semibold px-3 py-1 rounded-lg capitalize transition-colors ${
              status === s ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-14 text-zinc-500">
          <div className="text-3xl mb-2">🪪</div>
          <p className="text-sm">No {status} claims</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(c => (
            <div key={c.id} className="bg-zinc-900 rounded-xl border border-white/5 p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {c.claimant.name} <span className="text-zinc-500 font-normal">claims</span> {c.business.name}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {c.claimant.email} · {c.business.category}{c.business.neighborhood ? ` · ${c.business.neighborhood}` : ''} · {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {c.business.claimedById && c.business.claimedById !== c.claimant.id && (
                  <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Already claimed by someone else</span>
                )}
              </div>
              <p className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950 border border-zinc-800 rounded-lg p-3">{c.message}</p>
              {c.reviewedBy && (
                <p className="text-[11px] text-zinc-500">Reviewed by {c.reviewedBy.name}{c.reviewedAt ? ` · ${new Date(c.reviewedAt).toLocaleDateString()}` : ''}</p>
              )}
              {status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => act(c.id, 'approve')}
                    disabled={acting === c.id}
                    className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {acting === c.id ? '…' : 'Approve & verify owner'}
                  </button>
                  <button
                    onClick={() => act(c.id, 'reject')}
                    disabled={acting === c.id}
                    className="text-xs font-semibold bg-red-600/80 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --------------- Reports surface ---------------

interface ReportRow {
  id: string
  reason: string
  message: string | null
  status: 'pending' | 'resolved' | 'dismissed'
  createdAt: string
  reviewedAt: string | null
  business: { id: string; name: string; category: string; neighborhood: string | null; isApproved: boolean; isActive: boolean }
  reporter: { id: string; name: string; email: string } | null
  reviewedBy: { id: string; name: string } | null
}

const REASON_LABEL: Record<string, string> = {
  closed:        '🚪 Closed',
  wrong_info:    '📍 Wrong info',
  inappropriate: '⚠️ Inappropriate',
  other:         '✏️ Other',
}

function ReportsList() {
  const [status,  setStatus]  = useState<'pending' | 'resolved' | 'dismissed'>('pending')
  const [rows,    setRows]    = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/app/api/admin/directory/reports?status=${status}`, { credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || `Couldn't load reports (HTTP ${r.status})`)
        setRows([])
        return
      }
      const d = await r.json()
      setRows(Array.isArray(d) ? d : [])
    } catch {
      toast.error('Network error — could not load reports')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'resolve' | 'dismiss') {
    setActing(id)
    try {
      const r = await fetch(`/app/api/admin/directory/reports/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed')
        return
      }
      toast.success(action === 'resolve' ? 'Marked resolved' : 'Dismissed')
      load()
    } catch {
      toast.error('Network error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-zinc-900 p-1 rounded-xl w-fit">
        {(['pending', 'resolved', 'dismissed'] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`text-xs font-semibold px-3 py-1 rounded-lg capitalize transition-colors ${
              status === s ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-14 text-zinc-500">
          <div className="text-3xl mb-2">🚩</div>
          <p className="text-sm">No {status} reports</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="bg-zinc-900 rounded-xl border border-white/5 p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {REASON_LABEL[r.reason] ?? r.reason} · {r.business.name}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {r.reporter ? `${r.reporter.name} · ${r.reporter.email}` : 'Anonymous reporter'} · {new Date(r.createdAt).toLocaleDateString()}
                    {' · '}
                    <span className="text-zinc-400">{r.business.category}{r.business.neighborhood ? ` · ${r.business.neighborhood}` : ''}</span>
                  </p>
                </div>
              </div>
              {r.message && (
                <p className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950 border border-zinc-800 rounded-lg p-3">{r.message}</p>
              )}
              {r.reviewedBy && (
                <p className="text-[11px] text-zinc-500">Reviewed by {r.reviewedBy.name}{r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString()}` : ''}</p>
              )}
              {status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => act(r.id, 'resolve')}
                    disabled={acting === r.id}
                    className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {acting === r.id ? '…' : 'Mark resolved'}
                  </button>
                  <button
                    onClick={() => act(r.id, 'dismiss')}
                    disabled={acting === r.id}
                    className="text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminDirectoryPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const raw          = searchParams.get('status')
  // Tab order is Approved → Pending → Rejected, so the first tab is also
  // the default landing view when no ?status= param is present.
  const view: View   = raw === 'pending' || raw === 'rejected' || raw === 'claims' || raw === 'reports' ? raw : 'approved'

  const isClaims  = view === 'claims'
  const isReports = view === 'reports'
  const isAux     = isClaims || isReports
  const { data, loading, error, retry } = useAdminLoad<Business[]>(
    `/app/api/admin/directory?status=${isAux ? 'approved' : view}`,
    (v): v is Business[] => Array.isArray(v),
    { enabled: !isAux },
  )
  const items = data ?? []
  const [showAdd, setShowAdd] = useState(false)

  function setView(v: View) {
    router.replace(`/admin/directory?status=${v}`)
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Business Directory</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Manage expat-owned and expat-friendly business listings</p>
        </div>
        {!showAdd && !isAux && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
          >
            + Add business
          </button>
        )}
      </div>

      {showAdd && !isAux && (
        <CreateForm
          onCreated={() => { retry(); setView('approved') }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Tabs. Approved / Pending / Rejected partition every business
          row; the fourth Claims tab is a different model entirely
          (ownership claims) and uses its own list component. */}
      <div className="flex gap-1 mb-5 bg-zinc-900 p-1 rounded-xl w-fit">
        {(['approved', 'pending', 'rejected', 'claims', 'reports'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`text-xs font-semibold px-4 py-1.5 rounded-lg capitalize transition-colors ${
              view === v ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {v}
          </button>
        ))}
      </div>

      {isClaims ? (
        <ClaimsList />
      ) : isReports ? (
        <ReportsList />
      ) : error ? (
        <LoadErrorBanner message={error} onRetry={retry} />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-14 text-zinc-500">
          <div className="text-3xl mb-2">🏢</div>
          <p className="text-sm">
            {view === 'pending'  ? 'No pending submissions' :
             view === 'approved' ? 'No approved listings yet' :
                                   'No rejected submissions'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(b => <BusinessRow key={b.id} b={b} onAction={retry} />)}
        </div>
      )}
    </div>
  )
}
