'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

const CATEGORIES = [
  { id: 'ROOMS',    label: 'Room / Flat',        emoji: '🏠' },
  { id: 'JOBS',     label: 'Job / Gig',          emoji: '💼' },
  { id: 'SERVICES', label: 'Service / Skill',    emoji: '🛠️' },
  { id: 'BUY_SELL', label: 'Buy & Sell',         emoji: '🛍️' },
  { id: 'FREE',     label: 'Free stuff',         emoji: '🎁' },
  { id: 'RECO',     label: 'Recommendation',     emoji: '⭐' },
]

export default function NewListingPage() {
  const router = useRouter()
  // Posting is members-only — anonymous visitors get bounced to login. The page
  // itself lives outside the (member) route group so the rest of /listings/* can
  // be public; this manual gate replaces the group's auth-redirect for just this
  // page.
  const { isLoggedIn, isLoading } = useAuth()
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login?next=/listings/new')
  }, [isLoading, isLoggedIn, router])

  const [category, setCategory]     = useState('')
  const [title, setTitle]           = useState('')
  const [description, setDesc]      = useState('')
  const [price, setPrice]           = useState('')
  const [contact, setContact]       = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [photo, setPhoto]           = useState('')
  const [uploading, setUploading]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('folder', 'listings')
    const res  = await fetch('/app/api/upload', { method: 'POST', body: form, credentials: 'include' })
    const data = await res.json()
    if (data.path) setPhoto(data.path)
    setUploading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!category) { setError('Pick a category'); return }
    if (!title.trim()) { setError('Add a title'); return }
    if (!description.trim()) { setError('Add a description'); return }

    setSubmitting(true)
    const res = await fetch('/app/api/listings', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, title, description, price: price || null, contact: contact || null, photo: photo || null, neighborhood: neighborhood || null }),
    })
    if (res.ok) {
      router.push('/listings')
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1 transition-colors">
            ← Back to Board
          </button>
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Community Board</span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Post a listing</h1>
          <p className="text-base text-gray-500 mt-1">Expires automatically after 30 days.</p>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">

        <form onSubmit={handleSubmit} className="space-y-6 pb-8">
          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-colors text-sm font-medium ${
                    category === cat.id
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-amber-200'
                  }`}
                >
                  <span className="text-xl">{cat.emoji}</span>
                  <span className="text-center text-xs leading-tight">{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={120}
              placeholder={
                category === 'ROOMS'    ? 'e.g. Furnished room in Kadıköy, €400/mo' :
                category === 'JOBS'     ? 'e.g. Looking for a React developer' :
                category === 'SERVICES' ? 'e.g. English/Spanish tutoring, photography, design...' :
                category === 'FREE'     ? 'e.g. IKEA desk — free, pick up in Beşiktaş' :
                category === 'RECO'     ? 'e.g. Best English-speaking dentist in Kadıköy?' :
                'e.g. iPhone 13 Pro — great condition'
              }
              className="input"
            />
            <p className="text-right text-xs text-gray-400 mt-1">{title.length}/120</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDesc(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="Add all the details…"
              className="input resize-none"
            />
            <p className="text-right text-xs text-gray-400 mt-1">{description.length}/2000</p>
          </div>

          {/* Price */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Price <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={price}
              onChange={e => setPrice(e.target.value)}
              maxLength={50}
              placeholder="e.g. €500/mo · €120 · Free · Negotiable"
              className="input"
            />
          </div>

          {/* Neighborhood */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Neighborhood {category === 'ROOMS' ? <span className="text-gray-500 font-normal">(recommended)</span> : <span className="text-gray-400 font-normal">(optional)</span>}
            </label>
            <select
              value={neighborhood}
              onChange={e => setNeighborhood(e.target.value)}
              className="input bg-white"
            >
              <option value="">— Pick one —</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Lets people filter listings by area.</p>
          </div>

          {/* WhatsApp contact */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              WhatsApp contact <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={contact}
              onChange={e => setContact(e.target.value)}
              maxLength={200}
              placeholder="Phone number or wa.me link"
              className="input"
            />
          </div>

          {/* Photo */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Photo <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            {photo ? (
              <div className="relative w-full h-40 rounded-xl overflow-hidden">
                <img src={`/app${photo}`} alt="Listing photo" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhoto('')}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-amber-300 transition-colors">
                {uploading ? (
                  <span className="text-sm text-gray-400">Uploading…</span>
                ) : (
                  <>
                    <span className="text-2xl mb-1">📷</span>
                    <span className="text-sm text-gray-400">Tap to upload a photo</span>
                  </>
                )}
                <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" disabled={uploading} />
              </label>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

          <p className="text-xs text-gray-400">Listings expire automatically after 30 days.</p>

          <button
            type="submit"
            disabled={submitting || uploading}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors"
          >
            {submitting ? 'Posting…' : 'Post listing'}
          </button>
        </form>
      </div>
    </div>
  )
}
