'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { isSafeHref } from '@/lib/safeUrl'
import { BUSINESS_CATEGORIES, DIRECTORY_LIMITS } from '@/lib/directory'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

type View = 'pending' | 'approved' | 'rejected'

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
  isExpatOwned: boolean
  isExpatFriendly: boolean
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
              <input maxLength={DIRECTORY_LIMITS.logo} placeholder="https://…" {...field('logo')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cover image URL</label>
              <input maxLength={DIRECTORY_LIMITS.coverImage} placeholder="https://…" {...field('coverImage')} className={inputCls} />
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
              <input value={form.logo} onChange={e => set('logo', e.target.value)} maxLength={DIRECTORY_LIMITS.logo} placeholder="https://…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cover image URL</label>
              <input value={form.coverImage} onChange={e => set('coverImage', e.target.value)} maxLength={DIRECTORY_LIMITS.coverImage} placeholder="https://…" className={inputCls} />
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

export default function AdminDirectoryPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const raw          = searchParams.get('status')
  const view: View   = raw === 'approved' || raw === 'rejected' ? raw : 'pending'

  const { data, loading, error, retry } = useAdminLoad<Business[]>(
    `/app/api/admin/directory?status=${view}`,
    (v): v is Business[] => Array.isArray(v),
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
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
          >
            + Add business
          </button>
        )}
      </div>

      {showAdd && (
        <CreateForm
          onCreated={() => { retry(); setView('approved') }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Tabs. Pending / Approved / Rejected — the rejected bucket
          surfaces entries that previously fell into the void (reject
          set isApproved=false AND isActive=false, which matched
          neither of the two original tabs). */}
      <div className="flex gap-1 mb-5 bg-zinc-900 p-1 rounded-xl w-fit">
        {(['pending', 'approved', 'rejected'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`text-xs font-semibold px-4 py-1.5 rounded-lg capitalize transition-colors ${
              view === v ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {v}
          </button>
        ))}
      </div>

      {error ? (
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
