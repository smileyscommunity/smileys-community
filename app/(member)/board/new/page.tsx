'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCityNeighborhoods } from '@/hooks/useCityNeighborhoods'
import { downscaleImage } from '@/lib/image-resize'

const CATEGORIES = [
  { id: 'ROOMS',    label: 'Room / Flat',        emoji: '🏠' },
  { id: 'JOBS',     label: 'Job / Gig',          emoji: '💼' },
  { id: 'SERVICES', label: 'Service / Skill',    emoji: '🛠️' },
  { id: 'BUY_SELL', label: 'Buy & Sell',         emoji: '🛍️' },
  { id: 'FREE',       label: 'Free stuff',         emoji: '🎁' },
  { id: 'WANTED',     label: 'Wanted',             emoji: '🔎' },
  { id: 'PETS',       label: 'Adopt a Pet',        emoji: '🐾' },
]
// LOST_FOUND / RECO / EXPERIENCES retired from posting (zero active
// listings at retirement): recommendations and lost&found now live as
// Board posts. Legacy listings in those categories still render.

export default function NewListingPage() {
  const router = useRouter()
  // Posting is members-only — anonymous visitors get bounced to login. The page
  // itself lives outside the (member) route group so the rest of /board/* can
  // be public; this manual gate replaces the group's auth-redirect for just this
  // page.
  const { isLoggedIn, isLoading } = useAuth()
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login?next=/board/new')
  }, [isLoading, isLoggedIn, router])
  const neighborhoods = useCityNeighborhoods()

  // Prefill from query params — the moving-sale → rooms bridge arrives as
  // /board/new?category=ROOMS&neighborhood=…&availableFrom=…. Categories
  // validate against the picker's own ids; junk params fall back to blank.
  const search = useSearchParams()
  const paramCategory = search.get('category') ?? ''
  const [category, setCategory]     = useState(CATEGORIES.some(c => c.id === paramCategory) ? paramCategory : '')
  const [title, setTitle]           = useState('')
  const [description, setDesc]      = useState('')
  const [price, setPrice]           = useState('')
  const [contact, setContact]       = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [neighborhood, setNeighborhood] = useState(search.get('neighborhood') ?? '')
  const [photo, setPhoto]           = useState('')
  const [photos, setPhotos]         = useState<string[]>([])   // gallery beyond the cover, max 4
  // Category-specific attributes (§9-12) — the API allowlists per category,
  // so anything inapplicable is dropped server-side.
  const [housingType,   setHousingType]   = useState('')
  const [availableFrom, setAvailableFrom] = useState(/^\d{4}-\d{2}-\d{2}$/.test(search.get('availableFrom') ?? '') ? search.get('availableFrom')! : '')
  const [furnished,     setFurnished]     = useState<boolean | null>(null)
  const [jobType,       setJobType]       = useState('')
  const [remote,        setRemote]        = useState('')
  const [rateUnit,      setRateUnit]      = useState('')
  const [serviceOnline, setServiceOnline] = useState(false)
  const [petGoal,       setPetGoal]       = useState('')
  const [photoPosition, setPhotoPosition] = useState(50)
  const [uploading, setUploading]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const upload = await downscaleImage(file)
    const form = new FormData()
    form.append('file', upload)
    form.append('folder', 'listings')
    const res  = await fetch('/app/api/upload', { method: 'POST', body: form, credentials: 'include' })
    const data = await res.json()
    if (data.url) setPhoto(data.url)
    setUploading(false)
  }

  async function handleGalleryPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || photos.length >= 4) return
    setUploading(true)
    const upload = await downscaleImage(file)
    const form = new FormData()
    form.append('file', upload)
    form.append('folder', 'listings')
    const res  = await fetch('/app/api/upload', { method: 'POST', body: form, credentials: 'include' })
    const data = await res.json()
    if (data.url) setPhotos(prev => [...prev, data.url])
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
      body: JSON.stringify({
        category, title, description, price: price || null, contact: contact || null, contactEmail: contactEmail || null,
        photo: photo || null, photoPosition, neighborhood: neighborhood || null,
        photos,
        attrs: {
          ...(category === 'ROOMS' ? { ...(housingType && { housingType }), ...(availableFrom && { availableFrom }), ...(furnished !== null && { furnished }) } : {}),
          ...(category === 'JOBS'  ? { ...(jobType && { jobType }), ...(remote && { remote }) } : {}),
          ...(category === 'SERVICES' ? { ...(rateUnit && { rateUnit }), online: serviceOnline } : {}),
          ...(category === 'PETS'  ? { ...(petGoal && { petGoal }) } : {}),
        },
      }),
    })
    if (res.ok) {
      router.push('/board')
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
          <p className="text-base text-gray-600 mt-1">Expires automatically after 30 days.</p>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">

        <form onSubmit={handleSubmit} className="space-y-6 pb-8">
          {/* Category */}
          <div>
            <p className="block text-sm font-semibold text-gray-700 mb-2">Category</p>
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
            <label htmlFor="nl-title" className="block text-sm font-semibold text-gray-700 mb-1.5">Title</label>
            <input
              id="nl-title"
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
                category === 'PETS'        ? 'e.g. 2-year-old tabby cat looking for a loving home' :
                category === 'LOST_FOUND'  ? 'e.g. Lost black wallet near Kadıköy market on Saturday' :
                category === 'EXPERIENCES' ? 'e.g. Spare ticket to Coldplay Istanbul, selling at face value' :
                'e.g. iPhone 13 Pro — great condition'
              }
              className="input"
            />
            <p className="text-right text-xs text-gray-400 mt-1">{title.length}/120</p>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="nl-description" className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
            <textarea
              id="nl-description"
              value={description}
              onChange={e => setDesc(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="Add all the details…"
              className="input resize-none"
            />
            <p className="text-right text-xs text-gray-400 mt-1">{description.length}/2000</p>
          </div>

          {/* Category-specific fields (§9-12) — only the active category's
              block renders, so the form never shows an inapplicable input. */}
          {category === 'ROOMS' && (
            <div className="space-y-3 bg-blue-50/50 border border-blue-100 rounded-xl p-4">
              <div className="flex gap-1.5 flex-wrap">
                {([['room','Room'],['apartment','Apartment'],['roommate','Roommate wanted'],['sublet','Sublet']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setHousingType(housingType === v ? '' : v)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      housingType === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                    }`}>{l}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700 mb-1">Available from</span>
                  <input type="date" value={availableFrom} onChange={e => setAvailableFrom(e.target.value)} className="input" />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700 mb-1">Furnished?</span>
                  <select value={furnished === null ? '' : String(furnished)} onChange={e => setFurnished(e.target.value === '' ? null : e.target.value === 'true')} className="input bg-white">
                    <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                ⚠️ Never send deposits before seeing a property and verifying who you&apos;re dealing with.
              </p>
            </div>
          )}
          {category === 'JOBS' && (
            <div className="grid grid-cols-2 gap-3 bg-green-50/50 border border-green-100 rounded-xl p-4">
              <label className="block">
                <span className="block text-xs font-semibold text-gray-700 mb-1">Job type</span>
                <select value={jobType} onChange={e => setJobType(e.target.value)} className="input bg-white">
                  <option value="">—</option><option value="full_time">Full-time</option><option value="part_time">Part-time</option>
                  <option value="freelance">Freelance</option><option value="gig">One-off gig</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-gray-700 mb-1">Where</span>
                <select value={remote} onChange={e => setRemote(e.target.value)} className="input bg-white">
                  <option value="">—</option><option value="remote">Remote</option><option value="in_person">In person</option><option value="hybrid">Hybrid</option>
                </select>
              </label>
            </div>
          )}
          {category === 'SERVICES' && (
            <div className="flex items-end gap-3 bg-orange-50/50 border border-orange-100 rounded-xl p-4">
              <label className="block flex-1">
                <span className="block text-xs font-semibold text-gray-700 mb-1">Price is per</span>
                <select value={rateUnit} onChange={e => setRateUnit(e.target.value)} className="input bg-white">
                  <option value="">—</option><option value="hour">Hour</option><option value="session">Session</option>
                  <option value="day">Day</option><option value="fixed">Fixed price</option>
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2.5 cursor-pointer">
                <input type="checkbox" checked={serviceOnline} onChange={e => setServiceOnline(e.target.checked)} className="accent-amber-500 w-4 h-4" />
                <span className="text-sm text-gray-700">Also online</span>
              </label>
            </div>
          )}
          {category === 'PETS' && (
            <div className="bg-pink-50/50 border border-pink-100 rounded-xl p-4 space-y-2">
              <div className="flex gap-1.5">
                {([['adoption','Adoption'],['foster','Foster']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setPetGoal(petGoal === v ? '' : v)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      petGoal === v ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-gray-600 border-gray-200'
                    }`}>{l}</button>
                ))}
              </div>
              <p className="text-xs text-gray-500">Adoption and foster only — no buying or selling animals.</p>
            </div>
          )}

          {photo && (
            <div>
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">
                More photos <span className="text-gray-400 font-normal">(up to 4)</span>
              </span>
              <div className="flex gap-2 flex-wrap items-center">
                {photos.map((u, i) => (
                  <div key={u} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.startsWith('/app') ? u : `/app${u}`} alt={`Photo ${i + 2}`} className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
                    <button type="button" onClick={() => setPhotos(prev => prev.filter(x => x !== u))}
                      aria-label="Remove photo"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 text-white text-xs leading-none">×</button>
                  </div>
                ))}
                {photos.length < 4 && (
                  <label className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 hover:border-amber-400 flex items-center justify-center cursor-pointer text-gray-400 text-2xl">
                    +
                    <input type="file" accept="image/*" onChange={handleGalleryPhoto} className="hidden" disabled={uploading} />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Price */}
          <div>
            <label htmlFor="nl-price" className="block text-sm font-semibold text-gray-700 mb-1.5">
              Price <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="nl-price"
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
            <label htmlFor="nl-neighborhood" className="block text-sm font-semibold text-gray-700 mb-1.5">
              Neighborhood {category === 'ROOMS' ? <span className="text-gray-600 font-normal">(recommended)</span> : <span className="text-gray-400 font-normal">(optional)</span>}
            </label>
            <select
              id="nl-neighborhood"
              value={neighborhood}
              onChange={e => setNeighborhood(e.target.value)}
              className="input bg-white"
            >
              <option value="">— Pick one —</option>
              {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Lets people filter listings by area.</p>
          </div>

          {/* WhatsApp contact */}
          <div>
            <label htmlFor="nl-contact" className="block text-sm font-semibold text-gray-700 mb-1.5">
              WhatsApp contact <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="nl-contact"
              type="text"
              value={contact}
              onChange={e => setContact(e.target.value)}
              maxLength={200}
              placeholder="Phone number or wa.me link"
              className="input"
            />
          </div>

          {/* Email contact */}
          <div>
            <label htmlFor="nl-contact-email" className="block text-sm font-semibold text-gray-700 mb-1.5">
              Email contact <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="nl-contact-email"
              type="email"
              value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              maxLength={200}
              placeholder="you@example.com"
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">Another way to reach you, alongside in-app messages.</p>
          </div>

          {/* Photo */}
          <div>
            <p className="block text-sm font-semibold text-gray-700 mb-1.5">
              Photo <span className="text-gray-400 font-normal">(optional)</span>
            </p>
            {photo ? (
              <div>
                <div className="relative w-full h-40 rounded-xl overflow-hidden">
                  <img src={photo} alt="Listing photo" className="w-full h-full object-cover"
                    style={{ objectPosition: `center ${photoPosition}%` }} />
                  <button
                    type="button"
                    onClick={() => setPhoto('')}
                    className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-gray-400 shrink-0">Top</span>
                  <input type="range" min={0} max={100} value={photoPosition}
                    onChange={e => setPhotoPosition(Number(e.target.value))}
                    className="flex-1 accent-amber-500 cursor-pointer" />
                  <span className="text-xs text-gray-400 shrink-0">Bottom</span>
                  <span className="text-xs text-gray-600 w-12 text-right shrink-0">
                    {photoPosition === 50 ? 'Center' : photoPosition === 0 ? 'Top' : photoPosition === 100 ? 'Bottom' : `${photoPosition}%`}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Drag to adjust the focal point so the subject stays visible.</p>
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
