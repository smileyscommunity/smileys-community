'use client'

// Verified-owner self-edit drawer. Shown as a small "Edit my business"
// link on the directory card for the row whose claimedById matches the
// current session. Posts to PATCH /api/directory/[id], which routes
// through the same field-update validator as the admin PATCH so
// allowlist rules are identical between the two.

import { useState } from 'react'
import { toast } from 'sonner'
import { BUSINESS_CATEGORIES, DIRECTORY_LIMITS } from '@/lib/directory-constants'
import { DAY_KEYS, DAY_LABELS, isValidRange } from '@/lib/businessHours'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { phonePlaceholder } from '@/lib/country'

interface BusinessLike {
  id: string
  name: string
  category: string
  description: string
  neighborhood: string | null
  address: string | null
  phone: string | null
  website: string | null
  instagram: string | null
  languages: string | null
  hours: Record<string, string | null> | null
  memberDiscount: string | null
  tags: string[]
}

type EditState = {
  name: string
  category: string
  description: string
  neighborhood: string
  address: string
  phone: string
  website: string
  instagram: string
  languages: string
  memberDiscount: string
  tagsStr: string
  hours: Record<string, string>
}

function initFromBusiness(b: BusinessLike): EditState {
  const hours: Record<string, string> = {}
  for (const d of DAY_KEYS) {
    const v = b.hours?.[d]
    hours[d] = typeof v === 'string' ? v : ''
  }
  return {
    name:           b.name,
    category:       b.category,
    description:    b.description,
    neighborhood:   b.neighborhood   ?? '',
    address:        b.address        ?? '',
    phone:          b.phone          ?? '',
    website:        b.website        ?? '',
    instagram:      b.instagram      ?? '',
    languages:      b.languages      ?? '',
    memberDiscount: b.memberDiscount ?? '',
    tagsStr:        (b.tags ?? []).join(', '),
    hours,
  }
}

export default function DirectoryOwnerEdit({
  b, onSaved,
}: { b: BusinessLike; onSaved: () => void }) {
  const country = useCurrentCity()?.country
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [s,    setS]    = useState<EditState>(() => initFromBusiness(b))

  async function save() {
    // Build hours patch — drop empty strings (treat as "closed/not set").
    // Validate each range here so we can surface a clean error before
    // round-tripping; the server validates again as a defense layer.
    const hoursPatch: Record<string, string | null> = {}
    for (const d of DAY_KEYS) {
      const v = s.hours[d]
      if (v && !isValidRange(v)) {
        toast.error(`${DAY_LABELS[d]} time must look like "09:00-22:00"`)
        return
      }
      hoursPatch[d] = v || null
    }

    setBusy(true)
    try {
      const r = await fetch(`/app/api/directory/${b.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           s.name,
          category:       s.category,
          description:    s.description,
          neighborhood:   s.neighborhood || null,
          address:        s.address      || null,
          phone:          s.phone        || null,
          website:        s.website      || null,
          instagram:      s.instagram    || null,
          languages:      s.languages    || null,
          memberDiscount: s.memberDiscount || null,
          tags: s.tagsStr,
          hours: hoursPatch,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to save'); return }
      toast.success('Saved')
      setOpen(false)
      onSaved()
    } catch {
      toast.error('Network error — not saved')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300'
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-gray-600 mb-1'

  return (
    <>
      <button
        onClick={() => { setS(initFromBusiness(b)); setOpen(true) }}
        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 hover:underline transition-colors"
      >
        ✎ Edit my business
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="text-base font-bold text-gray-900">Edit your business</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Name</label>
                  <input maxLength={DIRECTORY_LIMITS.name} value={s.name} onChange={e => setS(p => ({ ...p, name: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <select value={s.category} onChange={e => setS(p => ({ ...p, category: e.target.value }))} className={inputCls}>
                    {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea maxLength={DIRECTORY_LIMITS.description} rows={3}
                  value={s.description} onChange={e => setS(p => ({ ...p, description: e.target.value }))}
                  className={`${inputCls} resize-none`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Address</label>
                  <input maxLength={DIRECTORY_LIMITS.address} value={s.address} onChange={e => setS(p => ({ ...p, address: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input maxLength={DIRECTORY_LIMITS.phone} placeholder={phonePlaceholder(country)}
                    value={s.phone} onChange={e => setS(p => ({ ...p, phone: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input maxLength={DIRECTORY_LIMITS.website} placeholder="https://…"
                    value={s.website} onChange={e => setS(p => ({ ...p, website: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Instagram handle</label>
                  <input maxLength={DIRECTORY_LIMITS.instagram} placeholder="@handle"
                    value={s.instagram} onChange={e => setS(p => ({ ...p, instagram: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Languages</label>
                  <input maxLength={DIRECTORY_LIMITS.languages} placeholder="English, Turkish…"
                    value={s.languages} onChange={e => setS(p => ({ ...p, languages: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Smileys member perk</label>
                  <input maxLength={DIRECTORY_LIMITS.memberDiscount} placeholder='e.g. "10% off"'
                    value={s.memberDiscount} onChange={e => setS(p => ({ ...p, memberDiscount: e.target.value }))} className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Tags · comma-separated</label>
                  <input placeholder="Vegan, Brunch, Late-night, Wheelchair accessible"
                    value={s.tagsStr} onChange={e => setS(p => ({ ...p, tagsStr: e.target.value }))} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Hours · Mon–Sun</label>
                <p className="text-[10px] text-gray-600 mb-1.5">
                  Format: <code>09:00-22:00</code>. Leave blank for closed days. Cross-midnight ranges like <code>21:00-02:00</code> work too.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {DAY_KEYS.map(d => (
                    <div key={d} className="flex items-center gap-2">
                      <span className="w-10 text-[11px] font-semibold text-gray-600 uppercase">{DAY_LABELS[d]}</span>
                      <input
                        value={s.hours[d]}
                        onChange={e => setS(p => ({ ...p, hours: { ...p.hours, [d]: e.target.value } }))}
                        placeholder="09:00-22:00"
                        className={`${inputCls} flex-1 font-mono`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end shrink-0">
              <button onClick={() => setOpen(false)} className="text-sm font-semibold text-gray-600 hover:text-gray-700 px-4 py-2 transition-colors">
                Cancel
              </button>
              <button onClick={save} disabled={busy}
                className="text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-4 py-2 transition-colors disabled:opacity-50">
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
