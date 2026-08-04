'use client'

import { useState, useEffect, useRef } from 'react'
import ImageUpload from '@/components/ImageUpload'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

const CATEGORIES = [
  { id: 'ROOMS',       label: '🏠 Room / Flat'          },
  { id: 'JOBS',        label: '💼 Job / Gig'            },
  { id: 'SERVICES',    label: '🛠️ Service / Skill'      },
  { id: 'BUY_SELL',    label: '🛍️ Buy & Sell'           },
  { id: 'FREE',        label: '🎁 Free stuff'           },
  { id: 'LOST_FOUND',  label: '🔍 Lost & Found'         },
  { id: 'RECO',        label: '⭐ Recommendation'       },
  { id: 'EXPERIENCES', label: '🎟️ Events & Experiences' },
  { id: 'PETS',        label: '🐾 Adopt a Pet'          },
]

interface Member {
  id: string; name: string; email: string; color: string
}

export default function AdminNewListingPage() {
  const router = useRouter()

  const [form, setForm] = useState({
    category: 'ROOMS', title: '', description: '',
    price: '', contact: '', neighborhood: '', expiryDays: '30',
  })
  const [photo,         setPhoto]         = useState('')
  const [photoPosition, setPhotoPosition] = useState(50)
  const [submitting,    setSubmitting]    = useState(false)


  // Member picker
  const [memberSearch, setMemberSearch]   = useState('')
  const [memberResults, setMemberResults] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [memberSearching, setMemberSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!memberSearch.trim() || selectedMember) { setMemberResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setMemberSearching(true)
      try {
        const res  = await fetch(`/app/api/admin/users?search=${encodeURIComponent(memberSearch)}`, { credentials: 'include' })
        const data = await res.json()
        setMemberResults((Array.isArray(data) ? data : []).slice(0, 8))
      } finally {
        setMemberSearching(false)
      }
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [memberSearch, selectedMember])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedMember) { toast.error('Pick a member'); return }
    if (!form.title.trim()) { toast.error('Add a title'); return }
    if (!form.description.trim()) { toast.error('Add a description'); return }

    setSubmitting(true)
    const res = await fetch('/app/api/admin/listings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId:       selectedMember.id,
        category:     form.category,
        title:        form.title,
        description:  form.description,
        price:        form.price || null,
        photo:        photo || null,
        photoPosition,
        contact:      form.contact || null,
        neighborhood: form.neighborhood || null,
        expiryDays:   parseInt(form.expiryDays) || 30,
      }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? 'Failed'); return }
    const listing = await res.json()
    toast.success('Listing created')
    router.push(`/admin/listings/${listing.id}`)
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl space-y-6">
      <Link href="/admin/listings" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
        ← Back to Marketplace
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white">Add a listing</h1>
        <p className="text-sm text-zinc-400 mt-1">Post on behalf of any member.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Member picker */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest">Member</label>

          {selectedMember ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: selectedMember.color }}>
                {selectedMember.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-100">{selectedMember.name}</p>
                <p className="text-xs text-zinc-500">{selectedMember.email}</p>
              </div>
              <button type="button" onClick={() => { setSelectedMember(null); setMemberSearch('') }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1">
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {memberSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              )}
              {memberResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
                  {memberResults.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setSelectedMember(m); setMemberSearch(''); setMemberResults([]) }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-700 transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: m.color }}>
                        {m.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-100 truncate">{m.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Category</label>
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Title</label>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            maxLength={120}
            placeholder="e.g. Furnished room in Kadıköy, €400/mo"
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <p className="text-right text-xs text-zinc-600 mt-1">{form.title.length}/120</p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            maxLength={2000}
            rows={6}
            placeholder="Add all the details…"
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          />
          <p className="text-right text-xs text-zinc-600 mt-1">{form.description.length}/2000</p>
        </div>

        {/* Photo */}
        <ImageUpload
          value={photo}
          onChange={setPhoto}
          label="Photo (optional)"
          folder="listings"
          position={photoPosition}
          onPositionChange={setPhotoPosition}
        />

        {/* Price + Neighborhood */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Price <span className="text-zinc-600 font-normal">(optional)</span></label>
            <input
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              maxLength={50}
              placeholder="e.g. €500/mo"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Neighborhood <span className="text-zinc-600 font-normal">(optional)</span></label>
            <select
              value={form.neighborhood}
              onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">— None —</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* Contact */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp contact <span className="text-zinc-600 font-normal">(optional)</span></label>
          <input
            value={form.contact}
            onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
            maxLength={200}
            placeholder="Phone number or wa.me link"
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Expiry */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Expires after (days)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={form.expiryDays}
            onChange={e => setForm(f => ({ ...f, expiryDays: e.target.value }))}
            className="w-32 px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors"
        >
          {submitting ? 'Creating…' : 'Create listing'}
        </button>
      </form>
    </div>
  )
}
