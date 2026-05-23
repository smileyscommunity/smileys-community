'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { sanitize } from '@/lib/sanitize'

const CATEGORIES = ['Community', 'Club Stories', 'Events', 'Istanbul Guide', 'Tips']

interface PostFormProps {
  initial?: {
    id?: string
    title?: string
    excerpt?: string
    body?: string
    coverImage?: string
    status?: string
    category?: string
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
  const [category,    setCategory]    = useState(initial.category    ?? 'Community')
  const [saving,      setSaving]      = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [preview,     setPreview]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImageUpload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
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
        category,
      }
      const url    = isEdit ? `/app/api/admin/posts/${initial.id}` : '/app/api/admin/posts'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Save failed'); return }
      toast.success(publishNow ? 'Article published!' : 'Saved as draft')
      router.push('/admin/posts')
    } finally {
      setSaving(false)
    }
  }

  function renderPreview(text: string) {
    return text
      .split('\n\n')
      .map((block, i) => {
        const trimmed = block.trim()
        if (!trimmed) return null
        if (trimmed.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-zinc-100 mt-6 mb-2">{trimmed.slice(3)}</h2>
        if (trimmed.startsWith('### ')) return <h3 key={i} className="text-lg font-semibold text-zinc-200 mt-4 mb-1">{trimmed.slice(4)}</h3>
        if (trimmed.startsWith('- ')) {
          const items = trimmed.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))
          return <ul key={i} className="list-disc list-inside space-y-1 text-zinc-300 text-sm my-3">{items.map((it, j) => <li key={j}>{it}</li>)}</ul>
        }
        const html = sanitize(trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'))
        return <p key={i} className="text-zinc-300 text-sm leading-relaxed my-3" dangerouslySetInnerHTML={{ __html: html }} />
      })
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
            onClick={() => setPreview(p => !p)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              preview ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
            }`}
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
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
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Article title…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-xl font-bold text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
          />

          {/* Excerpt */}
          <textarea
            value={excerpt}
            onChange={e => setExcerpt(e.target.value)}
            placeholder="Short description (shown in listings)…"
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors resize-none"
          />

          {/* Body — editor or preview */}
          {preview ? (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 min-h-[400px]">
              {body.trim() ? renderPreview(body) : <p className="text-zinc-500 text-sm">Nothing to preview yet…</p>}
            </div>
          ) : (
            <div className="relative">
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={`Write your article here…\n\nUse ## for headings, **bold** for emphasis, - for bullet lists.\n\nDouble-enter creates a new paragraph.`}
                rows={22}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors resize-y font-mono leading-relaxed"
              />
              <div className="absolute bottom-3 right-3 text-xs text-zinc-600 pointer-events-none">
                {body.length} chars
              </div>
            </div>
          )}

          {/* Formatting hint */}
          {!preview && (
            <p className="text-xs text-zinc-500">
              <span className="font-mono">## Heading</span> · <span className="font-mono">**bold**</span> · <span className="font-mono">- list item</span> · Double-enter = new paragraph
            </p>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
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

          {/* Category */}
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Category</p>
            <div className="flex flex-col gap-1.5">
              {CATEGORIES.map(cat => (
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
