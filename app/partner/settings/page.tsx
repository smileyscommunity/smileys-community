'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface PartnerData {
  id: string
  name: string
  category: string
  discount: string
  address: string
  neighborhood: string
  website: string | null
  instagram: string | null
  logo: string | null
  coverImage: string | null
}

export default function PartnerSettings() {
  const [formData, setFormData] = useState<PartnerData | null>(null)
  // The last-saved record, so a save sends only what changed since.
  const [saved, setSaved] = useState<PartnerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setLoadingSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // A demoted partner gets a 403 with a reason; that used to read "No business
  // data found." (or hang on "Loading..." if the fetch threw). Nullable columns
  // are coerced to '' so controlled inputs never receive null.
  useEffect(() => {
    fetch('/app/api/partner')
      .then(async r => {
        const d = await r.json().catch(() => null)
        if (!r.ok || !d || typeof d !== 'object') {
          setLoadError(d?.error ?? `Could not load your business (HTTP ${r.status})`)
          return
        }
        const loaded = {
          ...d,
          name: d.name ?? '', category: d.category ?? '', discount: d.discount ?? '',
          address: d.address ?? '', neighborhood: d.neighborhood ?? '',
        }
        setFormData(loaded)
        setSaved(loaded)
      })
      .catch(() => setLoadError('Network error — could not load your business'))
      .finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData || !saved) return
    // Only the fields the partner actually edited. Empty optional fields go as
    // null (the route unsets them); the required text fields stay strings.
    // Echoing untouched values made a legacy website or handle block every save.
    const body: Record<string, string | null> = {}
    for (const key of ['name', 'discount'] as const) {
      if (formData[key] !== saved[key]) body[key] = formData[key]
    }
    for (const key of ['website', 'instagram', 'logo', 'coverImage'] as const) {
      if ((formData[key] || null) !== (saved[key] || null)) body[key] = formData[key] || null
    }
    if (Object.keys(body).length === 0) { toast('No changes to save'); return }
    setLoadingSaving(true)
    try {
      const res = await fetch('/app/api/partner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSaved(formData)
        toast.success('Business information updated')
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to update information')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setLoadingSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-zinc-500 text-sm">Loading...</div>
  if (!formData) return <div className="p-8 text-zinc-500 text-sm">{loadError ?? 'No business data found.'}</div>

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Business Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Update your public profile and discount details</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Business Name</label>
            <input
              type="text"
              value={formData.name ?? ''}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Discount Offering</label>
            <input
              type="text"
              value={formData.discount ?? ''}
              onChange={e => setFormData({ ...formData, discount: e.target.value })}
              placeholder="e.g. 15% off for Smiley members"
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Website</label>
              <input
                type="text"
                value={formData.website || ''}
                onChange={e => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://..."
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Instagram</label>
              <input
                type="text"
                value={formData.instagram || ''}
                onChange={e => setFormData({ ...formData, instagram: e.target.value })}
                placeholder="@username"
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Logo URL</label>
              <input
                type="text"
                value={formData.logo || ''}
                onChange={e => setFormData({ ...formData, logo: e.target.value })}
                placeholder="https://... or upload via admin"
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Cover Image URL</label>
              <input
                type="text"
                value={formData.coverImage || ''}
                onChange={e => setFormData({ ...formData, coverImage: e.target.value })}
                placeholder="https://... or upload via admin"
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
