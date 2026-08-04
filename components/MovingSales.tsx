'use client'

import { useCallback, useEffect, useState } from 'react'
import posthog from 'posthog-js'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import AvatarImg from '@/components/AvatarImg'
import { avatarUrl, ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { downscaleImage } from '@/lib/image-resize'

interface SaleItem { id: string; name: string; price: string | null; claimed: boolean }
interface Sale {
  id: string; leavingOn: string; neighborhood: string | null; note: string | null; photo: string | null
  user: { id: string; name: string; color: string; profilePhoto: string | null }
  items: SaleItem[]
}

function fmtLeaving(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// Moving & Leaving (plan §13) — one sale per departure instead of fifteen
// separate listings. Renders inside the Marketplace when the Moving card
// is selected.
export default function MovingSales() {
  const { user, isLoggedIn } = useAuth()
  const [sales,   setSales]   = useState<Sale[] | null>(null)
  const [showForm, setShowForm] = useState(false)

  // create form
  const [leavingOn,    setLeavingOn]    = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [note,         setNote]         = useState('')
  const [items,        setItems]        = useState<{ name: string; price: string }[]>([{ name: '', price: '' }])
  const [posting,      setPosting]      = useState(false)
  const [photo,        setPhoto]        = useState('')
  const [uploading,    setUploading]    = useState(false)

  // per-sale contact composer
  const [contactFor,  setContactFor]  = useState<string | null>(null)
  const [contactText, setContactText] = useState('')
  const [sending,     setSending]     = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/app/api/moving-sales', { credentials: 'include' })
    const data = await res.json().catch(() => ({ sales: [] }))
    setSales(data.sales ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const upload = await downscaleImage(file)
      const form = new FormData()
      form.append('file', upload)
      const res  = await fetch('/app/api/upload', { method: 'POST', body: form, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (data.url) setPhoto(data.url)
      else toast.error('Could not upload photo')
    } finally { setUploading(false) }
  }

  async function submit() {
    if (posting) return
    setPosting(true)
    try {
      const res = await fetch('/app/api/moving-sales', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leavingOn, neighborhood: neighborhood || undefined, note: note || undefined, items, photo: photo || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      posthog.capture('moving_sale_created', { items: items.filter(i => i.name.trim()).length })
      toast.success('Moving sale posted')
      setShowForm(false); setLeavingOn(''); setNeighborhood(''); setNote(''); setItems([{ name: '', price: '' }]); setPhoto('')
      load()
    } finally { setPosting(false) }
  }

  async function toggleClaimed(saleId: string, item: SaleItem) {
    const res = await fetch(`/app/api/moving-sales/${saleId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, claimed: !item.claimed }),
    })
    if (!res.ok) { toast.error('Could not update'); return }
    setSales(prev => prev?.map(sl => sl.id !== saleId ? sl : {
      ...sl, items: sl.items.map(it => it.id === item.id ? { ...it, claimed: !item.claimed } : it),
    }) ?? null)
  }

  async function sendContact(sale: Sale) {
    if (sending || !contactText.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/moving-sales/${sale.id}/contact`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: contactText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not send'); return }
      posthog.capture('moving_sale_contacted')
      toast.success('Message sent — replies land in your Messages')
      setContactFor(null); setContactText('')
    } finally { setSending(false) }
  }

  return (
    <div className="space-y-5">
      {/* Pitch + CTA */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-bold text-gray-900">Leaving Istanbul?</p>
          <p className="text-sm text-gray-600 mt-0.5">Sell or give away everything without creating fifteen separate posts.</p>
        </div>
        {isLoggedIn ? (
          <button onClick={() => setShowForm(v => !v)}
            className="shrink-0 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            {showForm ? '× Close' : '📦 Create a Moving Sale'}
          </button>
        ) : (
          <span className="text-xs text-gray-400">Sign in to post yours</span>
        )}
      </div>

      {showForm && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">Leaving on</span>
              <input type="date" value={leavingOn} min={new Date().toISOString().slice(0, 10)}
                onChange={e => setLeavingOn(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">Neighborhood</span>
              <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)} className="input bg-white">
                <option value="">— Optional —</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-sm font-semibold text-gray-700 mb-1.5">Note <span className="text-gray-400 font-normal">(optional)</span></span>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500}
              placeholder="Everything must go by the 28th — pickup in Cihangir." className="input" />
          </label>
          <div>
            <span className="block text-sm font-semibold text-gray-700 mb-1.5">Photo <span className="text-gray-400 font-normal">(optional — a wide shot of the pile sells better than a description)</span></span>
            {photo ? (
              <div className="relative w-full h-40 rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setPhoto('')}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center text-sm transition-colors">
                  ×
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center w-full h-40 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-amber-300 transition-colors">
                {uploading ? (
                  <span className="text-sm text-gray-400">Uploading…</span>
                ) : (
                  <span className="text-sm text-gray-400">Tap to upload a photo</span>
                )}
                <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" disabled={uploading} />
              </label>
            )}
          </div>
          <div>
            <span className="block text-sm font-semibold text-gray-700 mb-1.5">Items <span className="text-gray-400 font-normal">(up to 20 — leave price empty for FREE)</span></span>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2">
                  <input value={it.name} onChange={e => setItems(prev => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))}
                    maxLength={80} placeholder="Desk" className="input flex-1" />
                  <input value={it.price} onChange={e => setItems(prev => prev.map((p, j) => j === i ? { ...p, price: e.target.value } : p))}
                    maxLength={40} placeholder="₺2,000 or empty = FREE" className="input w-44" />
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}
                      aria-label="Remove item" className="px-3 text-gray-400 hover:text-red-500">×</button>
                  )}
                </div>
              ))}
            </div>
            {items.length < 20 && (
              <button type="button" onClick={() => setItems(prev => [...prev, { name: '', price: '' }])}
                className="mt-2 text-xs font-bold text-amber-600 hover:underline">+ Add item</button>
            )}
          </div>
          <button onClick={submit} disabled={posting || uploading || !leavingOn || !items.some(i => i.name.trim())}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors">
            {posting ? 'Posting…' : 'Post Moving Sale →'}
          </button>
        </div>
      )}

      {/* Sales */}
      {sales === null ? (
        <p className="text-sm text-gray-400 py-6">Loading…</p>
      ) : sales.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center">
          <div aria-hidden="true" className="text-4xl mb-3">📦</div>
          <p className="font-bold text-gray-900">No moving sales right now</p>
          <p className="text-sm text-gray-600 mt-1">When someone leaves Istanbul, their whole sale shows up here.</p>
        </div>
      ) : sales.map(sale => {
        const isOwner = isLoggedIn && user.id === sale.user.id
        const unclaimed = sale.items.filter(i => !i.claimed).length
        return (
          <div key={sale.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <AvatarImg src={avatarUrl(sale.user.profilePhoto, 96)} name={sale.user.name} color={sale.user.color}
                size="w-11 h-11" textSize="text-sm" className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900">{sale.user.name.split(' ')[0]}&apos;s Moving Sale</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Leaving {fmtLeaving(sale.leavingOn)}
                  {sale.neighborhood && <> · 📍 {sale.neighborhood}</>}
                  <> · {sale.items.length} item{sale.items.length !== 1 ? 's' : ''}{unclaimed < sale.items.length && ` (${unclaimed} left)`}</>
                </p>
              </div>
            </div>
            {sale.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sale.photo} alt="" className="mt-3 w-full h-48 object-cover rounded-xl" />
            )}
            {sale.note && <p className="text-sm text-gray-700 mt-3">{sale.note}</p>}
            <ul className="mt-3 divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
              {sale.items.map(it => (
                <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white">
                  <span className={`text-sm ${it.claimed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{it.name}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className={`text-sm font-bold ${it.claimed ? 'text-gray-300' : it.price ? 'text-gray-900' : 'text-teal-600'}`}>
                      {it.claimed ? 'Claimed' : it.price ?? 'FREE'}
                    </span>
                    {isOwner && (
                      <button onClick={() => toggleClaimed(sale.id, it)}
                        className="text-[11px] font-bold text-amber-600 hover:underline">
                        {it.claimed ? 'Unclaim' : 'Mark claimed'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {isLoggedIn && !isOwner && (
              contactFor === sale.id ? (
                <div className="mt-3 space-y-2">
                  <textarea value={contactText} onChange={e => setContactText(e.target.value)} rows={2} maxLength={300}
                    placeholder={`Hi ${sale.user.name.split(' ')[0]}, is the desk still available?`}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <div className="flex gap-2">
                    <button onClick={() => setContactFor(null)} className="px-4 py-2 text-xs font-bold text-gray-500">Cancel</button>
                    <button onClick={() => sendContact(sale)} disabled={sending || !contactText.trim()}
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors">
                      {sending ? 'Sending…' : 'Send message'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setContactFor(sale.id); setContactText('') }}
                  className="mt-3 w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors">
                  💬 Contact {sale.user.name.split(' ')[0]}
                </button>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
