'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import CitySelect from '@/components/admin/CitySelect'

const inputCls = 'bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none px-3 py-2.5 w-full text-sm'
const labelCls = 'block text-xs font-semibold text-zinc-400 mb-1.5'

const CATEGORIES = ['Cafe', 'Restaurant', 'Bar', 'Gym', 'Studio', 'Spa', 'Shop', 'Co-working', 'Hotel', 'Other']

export default function NewPartnerPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form,   setForm]   = useState({
    cityId:       '',   // '' = creator's own city; ids come from CitySelect
    name:         '',
    category:     '',
    discount:     '',
    address:      '',
    neighborhood: '',
    website:      '',
    instagram:    '',
    logo:         '',
    coverImage:   '',
  })

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const missing = []
    if (!form.name)         missing.push('Business name')
    if (!form.category)     missing.push('Category')
    if (!form.discount)     missing.push('Discount offer')
    if (!form.address)      missing.push('Address')
    if (!form.neighborhood) missing.push('Neighborhood')
    if (missing.length) { setError(`Missing: ${missing.join(', ')}`); return }

    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/partners', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, cityId: form.cityId || undefined }),
      })
      if (res.ok) {
        toast.success('Partner created ✓')
        router.push('/admin/partners')
      } else {
        const d = await res.json()
        setError(d.error ?? 'Failed to create partner')
      }
    } catch { setError('Something went wrong') }
    finally   { setSaving(false) }
  }

  return (
    <form onSubmit={handleSave} className="p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/partners" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Add partner</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Local business offering member discounts</p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Business info */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Business info</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CitySelect value={form.cityId} onChange={v => set('cityId', v)} className={inputCls} />
          <div className="sm:col-span-2">
            <label className={labelCls}>Business name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Petra Roasting Co." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Category *</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className={inputCls}>
              <option value="">Select category</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Discount offer *</label>
            <input type="text" value={form.discount} onChange={e => set('discount', e.target.value)}
              placeholder="e.g. 10% off for Smileys members" className={inputCls} />
          </div>
        </div>
      </section>

      {/* Location */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Location</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Address *</label>
            <input type="text" value={form.address} onChange={e => set('address', e.target.value)}
              placeholder="e.g. Kuruçeşme Cad. No:12, Beşiktaş" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Neighborhood *</label>
            <input type="text" value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)}
              placeholder="e.g. Beşiktaş" className={inputCls} />
          </div>
        </div>
      </section>

      {/* Online presence */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Online presence</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Website</label>
            <input type="text" value={form.website} onChange={e => set('website', e.target.value)}
              placeholder="https://..." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Instagram</label>
            <input type="text" value={form.instagram} onChange={e => set('instagram', e.target.value)}
              placeholder="@username" className={inputCls} />
          </div>
        </div>
      </section>

      {/* Images */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Images</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Logo URL</label>
            <input type="text" value={form.logo} onChange={e => set('logo', e.target.value)}
              placeholder="https://... image URL" className={inputCls} />
            {form.logo && (
              <img src={form.logo} alt="Logo preview" className="mt-2 w-14 h-14 rounded-xl object-cover border border-zinc-700" />
            )}
          </div>
          <div>
            <label className={labelCls}>Cover image URL</label>
            <input type="text" value={form.coverImage} onChange={e => set('coverImage', e.target.value)}
              placeholder="https://... image URL" className={inputCls} />
            {form.coverImage && (
              <img src={form.coverImage} alt="Cover preview" className="mt-2 w-full h-20 rounded-xl object-cover border border-zinc-700" />
            )}
          </div>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center justify-end gap-3 pb-6">
        <Link href="/admin/partners" className="px-5 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors">
          Cancel
        </Link>
        <button type="submit" disabled={saving}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-black text-sm font-bold rounded-xl transition-colors disabled:opacity-50">
          {saving ? 'Creating…' : 'Create partner'}
        </button>
      </div>
    </form>
  )
}
