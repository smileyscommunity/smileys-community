'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import AvatarImg from '@/components/AvatarImg'
import { avatarUrl, firstNameOf} from '@/lib/data'
import { useCityNeighborhoods } from '@/hooks/useCityNeighborhoods'
import { downscaleImage } from '@/lib/image-resize'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_CURRENCY, currencySymbol } from '@/lib/data'

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

async function copyShare(id: string): Promise<boolean> {
  const url = `${window.location.origin}/app/moving-sales/${id}`
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    // navigator.clipboard can be unavailable (older/embedded webviews); a
    // native prompt() is suppressed in the installed PWA, so surface the
    // link in a toast the user can long-press to copy instead.
    toast(url, { description: 'Long-press to copy this link' })
    return false
  }
}

// Moving & Leaving (plan §13) — one sale per departure instead of fifteen
// separate listings. Renders inside the Marketplace when the Moving card
// is selected.
// cityName comes from BoardHub's useCurrentCity — empty until it resolves,
// so both strings below fall back to city-neutral copy, never the default
// city's name.
export default function MovingSales({ cityName = '' }: { cityName?: string }) {
  const cur = useCurrentCity()?.currency ?? DEFAULT_CURRENCY
  const { user, isLoggedIn } = useAuth()
  const neighborhoods = useCityNeighborhoods()
  const [sales,   setSales]   = useState<Sale[] | null>(null)
  const [showForm, setShowForm] = useState(false)

  // Post-create rooms bridge — set once after a successful sale post.
  const [roomBridge, setRoomBridge] = useState<{ neighborhood: string; leavingOn: string } | null>(null)
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
  const [copiedId,    setCopiedId]    = useState<string | null>(null)

  async function handleShare(id: string) {
    const ok = await copyShare(id)
    if (ok) { setCopiedId(id); toast.success('Link copied!'); setTimeout(() => setCopiedId(null), 2000) }
  }

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
      // Rooms bridge (phase 3): someone selling their stuff before leaving
      // very likely has a room opening up — the single highest-value listing
      // this community can have. Capture the moment, prefilled.
      setRoomBridge({ neighborhood, leavingOn })
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
      {roomBridge && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-bold text-gray-900">Is your place opening up too? 🏠</p>
            <p className="text-sm text-gray-700 mt-0.5">A room listing is the most valuable thing you can leave the community.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/board/new?category=ROOMS${roomBridge.neighborhood ? `&neighborhood=${encodeURIComponent(roomBridge.neighborhood)}` : ''}${roomBridge.leavingOn ? `&availableFrom=${encodeURIComponent(roomBridge.leavingOn)}` : ''}`}
              className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
            >
              List the room
            </Link>
            <button onClick={() => setRoomBridge(null)} className="text-sm text-gray-500 hover:text-gray-700 font-semibold">
              Not this time
            </button>
          </div>
        </div>
      )}
      {/* Pitch + CTA */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-bold text-gray-900">{cityName ? `Leaving ${cityName}?` : 'Moving on?'}</p>
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
                {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
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
                    maxLength={40} placeholder={`${currencySymbol(cur).trim()}2,000 or empty = FREE`} className="input w-44" />
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
          <p className="text-sm text-gray-600 mt-1">{cityName ? `When someone leaves ${cityName}, their whole sale shows up here.` : 'When someone moves on, their whole sale shows up here.'}</p>
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
                <p className="font-bold text-gray-900">{firstNameOf(sale.user.name)}&apos;s Moving Sale</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Leaving {fmtLeaving(sale.leavingOn)}
                  {sale.neighborhood && <> · 📍 {sale.neighborhood}</>}
                  <> · {sale.items.length} item{sale.items.length !== 1 ? 's' : ''}{unclaimed < sale.items.length && ` (${unclaimed} left)`}</>
                </p>
              </div>
              <button onClick={() => handleShare(sale.id)} aria-label="Copy link to this moving sale"
                className="shrink-0 w-8 h-8 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors" title="Copy link">
                {copiedId === sale.id ? <span aria-hidden="true">✓</span> : (
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
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
                    placeholder={`Hi ${firstNameOf(sale.user.name)}, is the desk still available?`}
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
                  💬 Contact {firstNameOf(sale.user.name)}
                </button>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
