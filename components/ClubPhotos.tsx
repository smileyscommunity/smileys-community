'use client'

import { useState, useEffect, useRef } from 'react'
import { resolveImageUrl, getInitials } from '@/lib/data'
import { downscaleImage } from '@/lib/image-resize'
import { confirmToast } from '@/lib/confirmToast'

interface PhotoAuthor { id: string; name: string; color: string; photo: string | null }
interface Photo { id: string; url: string; caption: string | null; createdAt: string; source?: 'club' | 'event'; author: PhotoAuthor }

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

interface Props {
  slug: string
  canUpload: boolean
  isMember: boolean
  currentUserId?: string
  isAdmin?: boolean
  canPin?: boolean
  dark?: boolean
}

export default function ClubPhotos({ slug, canUpload, isMember, currentUserId, isAdmin, canPin, dark }: Props) {
  const [photos, setPhotos]       = useState<Photo[]>([])
  const [loading, setLoading]     = useState(true)
  const [caption, setCaption]     = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isMember) { setLoading(false); return }
    fetch(`/app/api/clubs/${slug}/photos`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setPhotos(data) })
      .finally(() => setLoading(false))
  }, [slug, isMember])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const upload = await downscaleImage(file)
      const form = new FormData()
      form.append('file', upload); form.append('folder', 'clubs')
      const uploadRes = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: form })
      if (!uploadRes.ok) throw new Error('Upload failed')
      const { url } = await uploadRes.json()
      const createRes = await fetch(`/app/api/clubs/${slug}/photos`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, caption: caption.trim() || null }),
      })
      if (!createRes.ok) { const d = await createRes.json(); throw new Error(d.error ?? 'Failed') }
      const newPhoto = await createRes.json()
      setPhotos(prev => [newPhoto, ...prev])
      setCaption('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) { setError(err.message ?? 'Upload failed') }
    setUploading(false)
  }

  async function deletePhoto(id: string) {
    if (!(await confirmToast('Delete this photo?'))) return
    const res = await fetch(`/app/api/clubs/${slug}/photos/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setPhotos(prev => prev.filter(p => p.id !== id))
  }

  const uploadCard  = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-4' : 'bg-white shadow-card rounded-2xl p-4'
  const emptyCard   = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center' : 'bg-white shadow-card rounded-2xl p-12 text-center'
  const title_      = dark ? 'text-zinc-200' : 'text-gray-800'
  const empty_      = dark ? 'text-zinc-500' : 'text-gray-600'
  const skelBg      = dark ? 'bg-zinc-800' : 'bg-gray-200'
  const photoBg     = dark ? 'bg-zinc-800' : 'bg-gray-100'
  const input       = dark
    ? 'bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400'
    : 'border border-gray-200 text-gray-800 placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400'
  const uploadBtn   = uploading
    ? (dark ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed')
    : 'bg-amber-500 hover:bg-amber-600 text-white'

  if (!isMember) return (
    <div className="text-center py-16">
      <span className="text-4xl block mb-3">🔒</span>
      <p className="font-semibold text-gray-900 mb-1">Members only</p>
      <p className="text-gray-600 text-sm">Join this club to see photos.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {canUpload && (
        <div className={uploadCard}>
          <p className={`text-sm font-semibold ${title_} mb-3`}>Upload a photo</p>
          <div className="flex flex-col gap-2">
            <input type="text" value={caption} onChange={e => setCaption(e.target.value)}
              placeholder="Caption (optional)" maxLength={200}
              className={`text-sm px-3 py-2 ${input}`} />
            <div className="flex items-center gap-3">
              <label className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl cursor-pointer transition-colors ${uploadBtn}`}>
                {uploading ? 'Uploading…' : '📷 Choose photo'}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
              </label>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className={`aspect-square ${skelBg} rounded-xl animate-pulse`} />)}
        </div>
      ) : photos.length === 0 ? (
        <div className={emptyCard}>
          <span className="text-4xl block mb-3">📸</span>
          <p className={`${empty_} text-sm`}>
            {canUpload ? 'No photos yet. Be the first to upload one!' : 'No photos uploaded yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map(photo => {
            const canDelete = photo.source !== 'event' && (currentUserId === photo.author.id || isAdmin || canPin)
            const authorPhoto = resolveImageUrl(photo.author.photo)
            return (
              <div key={photo.id} className={`relative group rounded-xl overflow-hidden ${photoBg} aspect-square`}>
                <img src={resolveImageUrl(photo.url)} alt={photo.caption ?? 'Club photo'}
                  loading="lazy" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-1.5">
                    {authorPhoto ? (
                      <img src={authorPhoto} alt={photo.author.name} loading="lazy" className="w-5 h-5 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0"
                        style={{ backgroundColor: photo.author.color }}>
                        {getInitials(photo.author.name)}
                      </div>
                    )}
                    <span className="text-white text-xs font-medium truncate">{photo.author.name}</span>
                    <span className="text-white/70 text-xs ml-auto shrink-0">{formatRelative(photo.createdAt)}</span>
                  </div>
                  {photo.caption && <p className="text-white text-xs mt-0.5 line-clamp-2">{photo.caption}</p>}
                </div>
                {canDelete && (
                  <button onClick={() => deletePhoto(photo.id)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white text-sm leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
