'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { resolveImageUrl } from '@/lib/data'
import { downscaleImage, ImageUploadError } from '@/lib/image-resize'

interface Photo {
  id: string
  url: string
  caption?: string | null
  createdAt: string | Date
  user: { id: string; name: string; color: string; profilePhoto?: string | null }
}

interface Props {
  eventId: string
  photos: Photo[]
  canUpload: boolean
  currentUserId?: string
}

function getInitials(name: string) {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export default function EventPhotos({ eventId, photos: initial, canUpload, currentUserId }: Props) {
  const [photos,    setPhotos]    = useState<Photo[]>(initial)
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [lightbox,  setLightbox]  = useState<Photo | null>(null)
  const [mounted,   setMounted]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Portal mount gate — lightbox renders to document.body to escape any
  // ancestor with backdrop-filter / transform that would otherwise become
  // the containing block for `position: fixed` and trap the overlay.
  useEffect(() => { setMounted(true) }, [])

  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) { setError('Only image files are allowed.'); return }
    setUploading(true); setError(null)
    try {
      const upload = await downscaleImage(file)
      const form = new FormData()
      form.append('file', upload)
      form.append('folder', 'events')
      const up = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: form })
      if (!up.ok) {
        const d = await up.json().catch(() => ({}))
        setError(d.error ?? 'Upload failed. Please try again.')
        return
      }
      const { url } = await up.json()

      const res = await fetch(`/app/api/events/${eventId}/photos`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (res.ok) {
        const photo = await res.json()
        setPhotos(prev => [photo, ...prev])
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Could not save photo.')
      }
    } catch (e) {
      // ImageUploadError carries a user-facing, actionable message
      // (0-byte iCloud photo, unconvertible oversized file) — show it
      // verbatim instead of the generic fallback.
      setError(e instanceof ImageUploadError ? e.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(photoId: string) {
    await fetch(`/app/api/events/${eventId}/photos`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId }),
    })
    setPhotos(prev => prev.filter(p => p.id !== photoId))
    if (lightbox?.id === photoId) setLightbox(null)
  }

  if (!canUpload && photos.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-gray-900">
          Photos {photos.length > 0 && <span className="text-gray-400 font-normal text-sm">({photos.length})</span>}
        </h2>
        {canUpload && (
          <>
            {error && <p className="text-xs text-red-500 mr-2">{error}</p>}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {uploading ? 'Uploading…' : 'Add photo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
            />
          </>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">📷</div>
          <p className="text-sm text-gray-400">No photos yet. Be the first to share a moment!</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map(p => (
            <div key={p.id} className="relative group aspect-square rounded-xl overflow-hidden cursor-pointer bg-gray-100"
              onClick={() => setLightbox(p)}>
              <img src={resolveImageUrl(p.url)} alt={p.caption ?? 'Event photo'} className="w-full h-full object-cover" />
              {(currentUserId === p.user.id) && (
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(p.id) }}
                  aria-label="Delete photo"
                  className="absolute top-1 right-1 w-9 h-9 bg-black/70 rounded-full flex md:hidden md:group-hover:flex items-center justify-center text-white text-sm"
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && mounted && createPortal(
        <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          style={{ zIndex: 9999 }}
          onClick={() => setLightbox(null)}>
          <button aria-label="Close" className="absolute top-4 right-4 w-10 h-10 bg-black/50 hover:bg-black/80 rounded-full flex items-center justify-center text-white text-lg transition-colors">✕</button>
          <img
            src={resolveImageUrl(lightbox.url)}
            alt={lightbox.caption ?? ''}
            className="max-w-full max-h-[80vh] rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <div className="mt-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: lightbox.user.color }}>
              {lightbox.user.profilePhoto
                ? <img src={resolveImageUrl(lightbox.user.profilePhoto)} className="w-full h-full rounded-full object-cover" />
                : getInitials(lightbox.user.name)}
            </div>
            <span className="text-white/80 text-sm">{lightbox.user.name}</span>
            {lightbox.caption && <span className="text-white/50 text-sm">· {lightbox.caption}</span>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
