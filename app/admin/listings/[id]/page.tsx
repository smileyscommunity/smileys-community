'use client'

import { useState, useEffect } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { resolveImageUrl } from '@/lib/data'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import ImageUpload from '@/components/ImageUpload'

const CATEGORY_OPTIONS = [
  { id: 'ROOMS',      label: 'Room / Flat'          },
  { id: 'JOBS',       label: 'Job / Gig'            },
  { id: 'SERVICES',   label: 'Service / Skill'      },
  { id: 'BUY_SELL',   label: 'Buy & Sell'           },
  { id: 'FREE',       label: 'Free stuff'           },
  { id: 'LOST_FOUND', label: 'Lost & Found'         },
  { id: 'RECO',       label: 'Recommendation'       },
  { id: 'EXPERIENCES',label: 'Events & Experiences' },
  { id: 'PETS',       label: 'Adopt a Pet'          },
]

const CAT_COLOR: Record<string, string> = {
  ROOMS:       'bg-blue-500/10 text-blue-400',
  JOBS:        'bg-green-500/10 text-green-400',
  SERVICES:    'bg-orange-500/10 text-orange-400',
  BUY_SELL:    'bg-purple-500/10 text-purple-400',
  FREE:        'bg-teal-500/10 text-teal-400',
  LOST_FOUND:  'bg-yellow-500/10 text-yellow-400',
  RECO:        'bg-amber-500/10 text-amber-400',
  EXPERIENCES: 'bg-indigo-500/10 text-indigo-400',
  PETS:        'bg-pink-500/10 text-pink-400',
}

const STATUS_COLOR: Record<string, string> = {
  active:  'bg-green-500/10 text-green-400 border-green-500/20',
  filled:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
}

interface Listing {
  id: string
  category: string
  title: string
  description: string
  price: string | null
  photo: string | null
  photoPosition: number
  contact: string | null
  neighborhood: string | null
  status: string
  expiresAt: string
  createdAt: string
  user: { id: string; name: string; email: string; color: string; profilePhoto: string | null }
}

function Avatar({ name, color, photo }: { name: string; color: string; photo: string | null }) {
  const src = resolveImageUrl(photo)
  if (src) return <img src={src} alt={name} className="w-10 h-10 rounded-full object-cover shrink-0" />
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
      style={{ backgroundColor: color }}>
      {name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function AdminListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [form, setForm] = useState({
    title: '', description: '', price: '', contact: '', neighborhood: '', category: '',
  })
  const [photo,         setPhoto]         = useState('')
  const [photoPosition, setPhotoPosition] = useState(50)

  useEffect(() => {
    fetch(`/app/api/admin/listings/${id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: Listing) => {
        setListing(data)
        setForm({
          title:        data.title,
          description:  data.description,
          price:        data.price ?? '',
          contact:      data.contact ?? '',
          neighborhood: data.neighborhood ?? '',
          category:     data.category,
        })
        setPhoto(data.photo ?? '')
        setPhotoPosition(data.photoPosition ?? 50)
      })
      .catch(() => toast.error('Failed to load listing'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title required'); return }
    setSaving(true)
    const res = await fetch(`/app/api/admin/listings/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:         form.title.trim(),
        description:   form.description.trim(),
        price:         form.price.trim() || null,
        contact:       form.contact.trim() || null,
        neighborhood:  form.neighborhood || null,
        category:      form.category,
        photo:         photo || null,
        photoPosition,
      }),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? 'Failed to save'); return }
    const updated = await res.json()
    setListing(l => l ? { ...l, ...updated } : l)
    toast.success('Saved')
  }

  async function handleStatus(status: string) {
    const res = await fetch(`/app/api/admin/listings/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? 'Failed'); return }
    setListing(l => l ? { ...l, status } : l)
    toast.success(`Status set to ${status}`)
    if (status === 'deleted') router.push('/admin/listings')
  }

  if (loading) return (
    <div className="p-8 max-w-3xl space-y-4">
      <div className="h-6 w-32 rounded bg-zinc-800 animate-pulse" />
      <div className="h-10 w-2/3 rounded-xl bg-zinc-800 animate-pulse" />
      <div className="h-48 rounded-2xl bg-zinc-800 animate-pulse" />
    </div>
  )

  if (!listing) return (
    <div className="p-8 text-zinc-400">Listing not found.</div>
  )

  // photo state is managed separately above

  return (
    <div className="p-4 sm:p-8 max-w-3xl space-y-6">
      {/* Back */}
      <Link href="/admin/listings" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
        ← Back to Board
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-lg ${CAT_COLOR[listing.category] ?? 'bg-zinc-700 text-zinc-400'}`}>
              {CATEGORY_OPTIONS.find(c => c.id === listing.category)?.label ?? listing.category}
            </span>
            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-lg border ${STATUS_COLOR[listing.status] ?? 'bg-zinc-700 text-zinc-400'}`}>
              {listing.status}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white truncate">{listing.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Posted {new Date(listing.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {' · '}Expires {new Date(listing.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <Link
          href={`/listings/${listing.id}`}
          target="_blank"
          className="shrink-0 px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
        >
          View live ↗
        </Link>
      </div>

      {/* Photo — inside the edit card below */}

      {/* Member */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
        <Avatar name={listing.user.name} color={listing.user.color} photo={listing.user.profilePhoto} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100">{listing.user.name}</p>
          <p className="text-xs text-zinc-500 truncate">{listing.user.email}</p>
        </div>
        <Link
          href={`/admin/users/${listing.user.id}`}
          className="shrink-0 px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
        >
          View member
        </Link>
      </div>

      {/* Edit form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">Edit</h2>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Category</label>
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {CATEGORY_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Title</label>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            maxLength={120}
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            maxLength={2000}
            rows={6}
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          />
        </div>

        {/* Price + Neighborhood */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Price</label>
            <input
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              maxLength={50}
              placeholder="e.g. €500/mo"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Neighborhood</label>
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

        {/* Photo */}
        <ImageUpload
          value={photo}
          onChange={setPhoto}
          label="Photo (optional)"
          folder="listings"
          position={photoPosition}
          onPositionChange={setPhotoPosition}
        />

        {/* Contact */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp contact</label>
          <input
            value={form.contact}
            onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
            maxLength={200}
            placeholder="Phone number or wa.me link"
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Status actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-3">
        <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">Status</h2>
        <div className="flex flex-wrap gap-2">
          {listing.status !== 'active' && (
            <button onClick={() => handleStatus('active')}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors">
              Set Active
            </button>
          )}
          {listing.status !== 'filled' && (
            <button onClick={() => handleStatus('filled')}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors">
              Mark Filled
            </button>
          )}
          {listing.status !== 'expired' && (
            <button onClick={() => handleStatus('expired')}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-zinc-700 border border-zinc-600 text-zinc-300 hover:bg-zinc-600 transition-colors">
              Mark Expired
            </button>
          )}
          {listing.status !== 'deleted' && (
            <button onClick={async () => { if (await confirmToast('Delete this listing?')) handleStatus('deleted') }}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
