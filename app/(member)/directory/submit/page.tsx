'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { useCityNeighborhoods } from '@/hooks/useCityNeighborhoods'
import { BUSINESS_CATEGORIES, DIRECTORY_LIMITS } from '@/lib/directory-constants'
import { downscaleImage } from '@/lib/image-resize'

const EMPTY_FORM = {
  name: '', category: '', description: '',
  neighborhood: '', address: '', phone: '',
  website: '', instagram: '', languages: '',
  coverImage: '',
  isExpatOwned: false, isExpatFriendly: false,
}

// Members-only pitch shown to anonymous visitors. Submitting a business
// requires a member account so we can attribute the submission and a
// rate-limit it per-user; non-members get steered to /apply instead of
// the previous behavior (silent redirect to /login, which felt like
// the page was broken).
function MembersOnlyPitch() {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-4">🏢</div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Submit a business</h2>
      <p className="text-sm text-gray-600 mb-6 leading-relaxed">
        Adding a business to the Smileys directory is a member benefit — it
        helps us keep the listings curated and spam-free. Apply to join
        the community and you'll be able to add your favourite expat-owned
        and expat-friendly spots in your city.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Link
          href="/apply"
          className="bg-amber-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-amber-600 transition-colors"
        >
          Apply to join Smileys
        </Link>
        <Link
          href="/directory"
          className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
        >
          Back to directory
        </Link>
      </div>
      <p className="text-[11px] text-gray-400 mt-4">
        Already a member? <Link href={`/login?next=${encodeURIComponent('/directory/submit')}`} className="text-amber-600 hover:underline">Log in</Link>.
      </p>
    </div>
  )
}

export default function SubmitBusinessPage() {
  const router = useRouter()
  const { isLoggedIn, isLoading } = useAuth()
  const neighborhoods = useCityNeighborhoods()
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [autoApproved, setAutoApproved] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [uploading,  setUploading]  = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Wait for the auth bootstrap so we don't flash the form to logged-in
  // members before useAuth resolves, or the pitch to a member who's
  // already authenticated but still loading.
  if (isLoading) return null
  if (!isLoggedIn) return <MembersOnlyPitch />


  function set(k: string, v: unknown) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'directory')
      const res  = await fetch('/app/api/upload', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) {
        setError(data?.error || 'Upload failed. Try a smaller image.')
        return
      }
      set('coverImage', data.url)
    } catch {
      setError('Upload failed. Try a smaller image.')
    } finally {
      setUploading(false)
      // Reset the input so picking the same file again still re-fires onChange.
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.category || !form.description.trim()) {
      setError('Name, category, and description are required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/app/api/directory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setError(data?.error || 'Failed to submit'); return }
      setAutoApproved(!!data?.approved)
      setDone(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          {autoApproved ? 'Live in the directory' : 'Submitted!'}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {autoApproved
            ? 'Your listing is live now. You can submit another or head back to the directory.'
            : "Thanks for adding to the Smileys directory. Our team will review your submission and it'll appear once approved."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button onClick={() => router.push('/directory')}
            className="bg-amber-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-amber-600 transition-colors">
            Back to Directory
          </button>
          {/* Let the submitter add a second business without a hard reload —
              the old "Submitted!" page sent them back to /directory and
              the form state was lost. */}
          <button
            onClick={() => { setForm(EMPTY_FORM); setDone(false); setAutoApproved(false); setError(null) }}
            className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
            Submit another
          </button>
        </div>
      </div>
    )
  }

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400'
  const labelCls = 'block text-xs font-semibold text-gray-600 mb-1'

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs text-gray-600 mb-5 hover:text-gray-700">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <h1 className="text-xl font-bold text-gray-900 mb-1">Submit a Business</h1>
      <p className="text-sm text-gray-600 mb-6">Know a great expat-owned or expat-friendly business? Add it to the community directory.</p>

      {/* Expat type cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button type="button" onClick={() => set('isExpatOwned', !form.isExpatOwned)}
          className={`p-4 rounded-2xl border-2 text-left transition-all ${
            form.isExpatOwned ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white hover:border-gray-300'
          }`}>
          <div className="text-2xl mb-1.5">👤</div>
          <p className="text-sm font-semibold text-gray-900">Expat-owned</p>
          <p className="text-[11px] text-gray-600 mt-0.5">Owned or co-owned by an expat</p>
          {form.isExpatOwned && <div className="mt-2 text-amber-600 text-xs font-bold">✓ Selected</div>}
        </button>
        <button type="button" onClick={() => set('isExpatFriendly', !form.isExpatFriendly)}
          className={`p-4 rounded-2xl border-2 text-left transition-all ${
            form.isExpatFriendly ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white hover:border-gray-300'
          }`}>
          <div className="text-2xl mb-1.5">🌍</div>
          <p className="text-sm font-semibold text-gray-900">Expat-friendly</p>
          <p className="text-[11px] text-gray-600 mt-0.5">English-speaking or welcoming to expats</p>
          {form.isExpatFriendly && <div className="mt-2 text-teal-600 text-xs font-bold">✓ Selected</div>}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls}>Business Name *</label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            maxLength={DIRECTORY_LIMITS.name}
            placeholder="e.g. Simit & Coffee Co."
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Category *</label>
          <select value={form.category} onChange={e => set('category', e.target.value)} className={inputCls}>
            <option value="">Select a category…</option>
            {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Description *</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            maxLength={DIRECTORY_LIMITS.description}
            placeholder="Tell members what makes this place great…"
            rows={3}
            className={`${inputCls} resize-none`}
          />
          <p className="text-[10px] text-gray-400 mt-1 text-right">
            {form.description.length}/{DIRECTORY_LIMITS.description}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Neighborhood</label>
            <select value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <input value={form.address} onChange={e => set('address', e.target.value)}
              placeholder="Street address" className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Phone</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)}
              placeholder="+90 5xx xxx xx xx" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Website</label>
            <input value={form.website} onChange={e => set('website', e.target.value)}
              placeholder="https://…" className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Instagram</label>
            <input value={form.instagram} onChange={e => set('instagram', e.target.value)}
              placeholder="@handle" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Languages spoken</label>
            <input value={form.languages} onChange={e => set('languages', e.target.value)}
              placeholder="English, Turkish…" className={inputCls} />
          </div>
        </div>

        {/* Cover photo — optional. Submitters previously had no way
            to attach a photo at submission time, so listings shipped
            without a cover and fell back to the 🏢 emoji placeholder
            in the directory grid. Single image, capped via the file
            route + downscaleImage(); admins can swap it later. */}
        <div>
          <p className={labelCls}>Cover photo <span className="text-gray-400 font-normal">(optional)</span></p>
          {form.coverImage ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveImageUrl(form.coverImage)}
                alt="Cover preview"
                className="w-full h-40 object-cover rounded-xl border border-gray-200"
              />
              <button
                type="button"
                onClick={() => set('coverImage', '')}
                aria-label="Remove cover photo"
                className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 flex flex-col items-center justify-center gap-1 text-xs text-gray-500 hover:border-amber-300 hover:text-amber-600 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <span>Uploading…</span>
              ) : (
                <>
                  <span aria-hidden="true" className="text-2xl">📷</span>
                  <span>Click to upload a photo</span>
                </>
              )}
            </button>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhoto}
            className="hidden"
            disabled={uploading}
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button type="submit" disabled={submitting || uploading}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
          {submitting ? 'Submitting…' : 'Submit for Review'}
        </button>
      </form>
    </div>
  )
}
