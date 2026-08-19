'use client'

import { useState, useRef } from 'react'
import CitySelect from '@/components/admin/CitySelect'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import RichTextEditor from '@/components/RichTextEditor'
import { CATEGORIES, HANDBOOK_CATEGORIES, normalizeHandbookCategory, TITLE_MAX, EXCERPT_MAX, BODY_MAX } from './constants'
import { downscaleImage } from '@/lib/image-resize'

interface PostFormProps {
  initial?: {
    id?: string
    title?: string
    excerpt?: string
    body?: string
    coverImage?: string
    status?: string
    kind?: string
    category?: string
    cityId?: string | null
  }
}

export default function PostForm({ initial = {} }: PostFormProps) {
  const router  = useRouter()
  const isEdit  = !!initial.id

  const [title,       setTitle]       = useState(initial.title      ?? '')
  const [excerpt,     setExcerpt]     = useState(initial.excerpt     ?? '')
  const [body,        setBody]        = useState(initial.body        ?? '')
  const [coverImage,  setCoverImage]  = useState(initial.coverImage  ?? '')
  const [status,      setStatus]      = useState(initial.status      ?? 'draft')
  const [kind,        setKind]        = useState(initial.kind        ?? 'community')
  // '' = global (shown in every city); an id pins the article to one city's
  // Stories. Global is the right default — most articles are network-wide.
  const [cityId,      setCityId]      = useState(initial.cityId ?? '')
  // A handbook article still stored under a legacy category key is shown
  // pre-selected on its canonical successor — otherwise the select renders with
  // nothing highlighted and an unwary save would land on the default category.
  const [category,    setCategory]    = useState(
    initial.kind === 'handbook'
      ? normalizeHandbookCategory(initial.category)
      : (initial.category ?? 'Community'),
  )
  const [saving,      setSaving]      = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImageUpload(file: File) {
    setUploading(true)
    try {
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'general')
      const res  = await fetch('/app/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Upload failed'); return }
      setCoverImage(data.url)
      toast.success('Image uploaded')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(publishNow?: boolean) {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        title, excerpt, body, coverImage,
        status: publishNow ? 'published' : status,
        kind,
        category,
        cityId: cityId || null,
      }
      const url    = isEdit ? `/app/api/admin/posts/${initial.id}` : '/app/api/admin/posts'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? 'Save failed'); return }
      // Differentiate update-of-published from new-publish so the
      // toast accurately reflects what happened.
      const msg = publishNow
        ? (initial.status === 'published' ? 'Article updated' : 'Article published!')
        : 'Saved as draft'
      toast.success(msg)
      router.push('/admin/posts')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/posts')} className="text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-zinc-100">{isEdit ? 'Edit article' : 'New article'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
          >
            {saving ? '…' : status === 'published' ? 'Update' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main editor */}
        <div className="lg:col-span-2 space-y-4">
          {/* Title */}
          <div>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Article title…"
              maxLength={TITLE_MAX}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-xl font-bold text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
            {title.length > TITLE_MAX - 20 && (
              <p className="text-right text-xs text-zinc-600 mt-1">{title.length}/{TITLE_MAX}</p>
            )}
          </div>

          {/* Excerpt */}
          <div>
            <textarea
              value={excerpt}
              onChange={e => setExcerpt(e.target.value)}
              placeholder="Short description (shown in listings)…"
              rows={2}
              maxLength={EXCERPT_MAX}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors resize-none"
            />
            {excerpt.length > EXCERPT_MAX - 50 && (
              <p className="text-right text-xs text-zinc-600 mt-1">{excerpt.length}/{EXCERPT_MAX}</p>
            )}
          </div>

          {/* Body — TipTap rich-text editor with a real toolbar. Same
              component used in event-description editors so writers get
              consistent affordances (B/I/U, headings, lists, color)
              and the output is sanitisable HTML the public renderer
              already handles. Replaces a raw textarea + homemade
              markdown preview pane that members never warmed to. */}
          <div>
            <RichTextEditor value={body} onChange={setBody} placeholder="Write your article — bold, headings, lists are all in the toolbar above." />
            <div className={`mt-2 text-right text-xs ${
              body.length > BODY_MAX - 1000 ? 'text-red-400 font-semibold' : 'text-zinc-600'
            }`}>
              {body.length.toLocaleString()}/{BODY_MAX.toLocaleString()} chars
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Type */}
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Type</p>
            <div className="flex gap-2">
              {([['community', 'Blog post'], ['handbook', 'Handbook']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => {
                    setKind(k)
                    setCategory(k === 'handbook' ? HANDBOOK_CATEGORIES[0] : CATEGORIES[0])
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    kind === k ? 'bg-amber-500 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Status</p>
            <div className="flex gap-2">
              {(['draft', 'published'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    status === s
                      ? s === 'published' ? 'bg-green-700 text-green-100' : 'bg-zinc-600 text-zinc-100'
                      : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* City — global by default; renders only when >1 city exists */}
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 empty:hidden">
            <CitySelect
              value={cityId}
              onChange={setCityId}
              label="City"
              emptyLabel="All cities (global)"
              className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Category */}
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Category</p>
            <div className="flex flex-col gap-1.5">
              {(kind === 'handbook' ? HANDBOOK_CATEGORIES : CATEGORIES).map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    category === cat
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Cover image */}
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Cover image</p>
            {coverImage ? (
              <div className="space-y-2">
                <img src={coverImage} alt="Cover" className="w-full h-32 object-cover rounded-lg" />
                <button
                  onClick={() => setCoverImage('')}
                  className="w-full py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full py-6 border-2 border-dashed border-zinc-600 hover:border-amber-500 rounded-lg text-xs text-zinc-500 hover:text-amber-400 transition-colors"
              >
                {uploading ? 'Uploading…' : 'Click to upload cover'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
