'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { resolveImageUrl } from '@/lib/data'

interface Testimonial {
  id:         string
  memberName: string
  role:       string | null
  quote:      string
  category:   string
  photo:      string | null
  active:     boolean
  order:      number
}

interface StoryPhoto {
  id:      string
  url:     string
  caption: string | null
  event:   string | null
  active:  boolean
  order:   number
}

const CATEGORIES = [
  { key: 'general',   label: 'General',           icon: '💬' },
  { key: 'friends',   label: 'Made close friends', icon: '🤝' },
  { key: 'expat',     label: 'New to Istanbul',    icon: '🌍' },
  { key: 'business',  label: 'Business partners',  icon: '💼' },
  { key: 'travel',    label: 'Travel buddies',      icon: '✈️' },
]

const CAT_COLORS: Record<string, string> = {
  general:  'bg-zinc-100 text-zinc-600',
  friends:  'bg-green-100 text-green-700',
  expat:    'bg-blue-100 text-blue-700',
  business: 'bg-purple-100 text-purple-700',
  travel:   'bg-amber-100 text-amber-700',
}

export default function StoriesPage() {
  const [tab, setTab] = useState<'testimonials' | 'photos'>('testimonials')

  // Testimonials state
  const [testimonials, setTestimonials] = useState<Testimonial[]>([])
  const [tLoading,     setTLoading]     = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [tForm,        setTForm]        = useState({ memberName: '', role: '', quote: '', category: 'general', photo: '' })
  const [tSaving,      setTSaving]      = useState(false)
  const [editId,       setEditId]       = useState<string | null>(null)

  // Photos state
  const [photos,    setPhotos]    = useState<StoryPhoto[]>([])
  const [pLoading,  setPLoading]  = useState(true)
  const [pForm,     setPForm]     = useState({ url: '', caption: '', event: '' })
  const [pSaving,   setPSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/app/api/admin/testimonials', { credentials: 'include' })
      .then(r => r.json()).then(d => { setTestimonials(Array.isArray(d) ? d : []); setTLoading(false) })
    fetch('/app/api/admin/story-photos', { credentials: 'include' })
      .then(r => r.json()).then(d => { setPhotos(Array.isArray(d) ? d : []); setPLoading(false) })
  }, [])

  // ── Testimonials ──────────────────────────────────────────
  function resetTForm() { setTForm({ memberName: '', role: '', quote: '', category: 'general', photo: '' }); setEditId(null); setShowForm(false) }

  function startEdit(t: Testimonial) {
    setTForm({ memberName: t.memberName, role: t.role ?? '', quote: t.quote, category: t.category, photo: t.photo ?? '' })
    setEditId(t.id)
    setShowForm(true)
  }

  async function saveTestimonial() {
    if (!tForm.memberName.trim() || !tForm.quote.trim()) { toast.error('Name and quote required'); return }
    setTSaving(true)
    try {
      if (editId) {
        const res = await fetch(`/app/api/admin/testimonials/${editId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tForm),
        })
        if (!res.ok) throw new Error()
        const updated = await res.json()
        setTestimonials(prev => prev.map(t => t.id === editId ? updated : t))
        toast.success('Updated!')
      } else {
        const res = await fetch('/app/api/admin/testimonials', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tForm),
        })
        if (!res.ok) throw new Error()
        const created = await res.json()
        setTestimonials(prev => [...prev, created])
        toast.success('Testimonial added!')
      }
      resetTForm()
    } catch { toast.error('Failed to save') }
    finally { setTSaving(false) }
  }

  async function toggleTestimonial(t: Testimonial) {
    const res = await fetch(`/app/api/admin/testimonials/${t.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !t.active }),
    })
    if (res.ok) setTestimonials(prev => prev.map(x => x.id === t.id ? { ...x, active: !x.active } : x))
  }

  async function deleteTestimonial(id: string) {
    if (!confirm('Delete this testimonial?')) return
    const res = await fetch(`/app/api/admin/testimonials/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) { setTestimonials(prev => prev.filter(t => t.id !== id)); toast.success('Deleted') }
  }

  // ── Photos ────────────────────────────────────────────────
  async function uploadPhoto(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'general')
      const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.url) setPForm(f => ({ ...f, url: data.url }))
      else toast.error('Upload failed')
    } catch { toast.error('Upload failed') }
    finally { setUploading(false) }
  }

  async function savePhoto() {
    if (!pForm.url.trim()) { toast.error('Photo required'); return }
    setPSaving(true)
    try {
      const res = await fetch('/app/api/admin/story-photos', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pForm),
      })
      if (!res.ok) throw new Error()
      const created = await res.json()
      setPhotos(prev => [...prev, created])
      setPForm({ url: '', caption: '', event: '' })
      toast.success('Photo added!')
    } catch { toast.error('Failed to save') }
    finally { setPSaving(false) }
  }

  async function togglePhoto(p: StoryPhoto) {
    const res = await fetch(`/app/api/admin/story-photos/${p.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !p.active }),
    })
    if (res.ok) setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, active: !x.active } : x))
  }

  async function deletePhoto(id: string) {
    if (!confirm('Delete this photo?')) return
    const res = await fetch(`/app/api/admin/story-photos/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) { setPhotos(prev => prev.filter(p => p.id !== id)); toast.success('Deleted') }
  }

  const activeTestimonials = testimonials.filter(t => t.active).length
  const activePhotos       = photos.filter(p => p.active).length

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Member Stories</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage testimonials and event photos shown on the Why Smileys page.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total testimonials', value: testimonials.length,  icon: '💬' },
          { label: 'Live',               value: activeTestimonials,   icon: '🟢' },
          { label: 'Event photos',       value: photos.length,        icon: '📸' },
          { label: 'Photos live',        value: activePhotos,         icon: '🟢' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-2xl font-extrabold text-white">{s.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([['testimonials', '💬 Testimonials'], ['photos', '📸 Event photos']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              tab === key ? 'bg-amber-500 text-white' : 'bg-zinc-900 border border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── TESTIMONIALS ── */}
      {tab === 'testimonials' && (
        <div className="space-y-5">
          {/* Add form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">
                {showForm ? (editId ? 'Edit testimonial' : 'Add testimonial') : 'Add testimonial'}
              </h2>
              <button onClick={() => showForm ? resetTForm() : setShowForm(true)}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${showForm ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>
                {showForm ? 'Cancel' : '+ Add'}
              </button>
            </div>

            {showForm && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Name</label>
                    <input value={tForm.memberName} onChange={e => setTForm(f => ({ ...f, memberName: e.target.value }))}
                      placeholder="Sarah K."
                      className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Role / Label</label>
                    <input value={tForm.role} onChange={e => setTForm(f => ({ ...f, role: e.target.value }))}
                      placeholder="Member since 2023"
                      className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Quote</label>
                  <textarea value={tForm.quote} onChange={e => setTForm(f => ({ ...f, quote: e.target.value }))}
                    placeholder="I moved to Istanbul not knowing anyone. Within 3 months of joining Smileys, I had a group of friends I'd known for years..."
                    rows={3}
                    className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Category</label>
                    <select value={tForm.category} onChange={e => setTForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
                      {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Photo URL (optional)</label>
                    <input value={tForm.photo} onChange={e => setTForm(f => ({ ...f, photo: e.target.value }))}
                      placeholder="/app/api/files/users/..."
                      className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                </div>

                <button onClick={saveTestimonial} disabled={tSaving}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-40">
                  {tSaving ? 'Saving…' : editId ? 'Update testimonial' : 'Add testimonial'}
                </button>
              </div>
            )}
          </div>

          {/* List */}
          {tLoading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : testimonials.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-sm">No testimonials yet. Add the first one above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {testimonials.map(t => {
                const cat = CATEGORIES.find(c => c.key === t.category)
                return (
                  <div key={t.id} className={`bg-zinc-900 border rounded-2xl p-4 flex gap-4 transition-opacity ${t.active ? 'border-zinc-800' : 'border-zinc-800 opacity-50'}`}>
                    {t.photo ? (
                      <img src={resolveImageUrl(t.photo)} alt={t.memberName}
                        className="w-12 h-12 rounded-full object-cover shrink-0 border-2 border-zinc-700" />
                    ) : (
                      <div className="w-12 h-12 rounded-full shrink-0 bg-amber-500/20 border-2 border-amber-500/30 flex items-center justify-center text-lg font-bold text-amber-400">
                        {t.memberName[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-white text-sm">{t.memberName}</span>
                        {t.role && <span className="text-xs text-zinc-500">{t.role}</span>}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${CAT_COLORS[t.category] ?? 'bg-zinc-100 text-zinc-600'}`}>
                          {cat?.icon} {cat?.label}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-400 line-clamp-2 leading-relaxed">"{t.quote}"</p>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button onClick={() => toggleTestimonial(t)}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-colors ${t.active ? 'bg-green-900/40 text-green-400 hover:bg-red-900/40 hover:text-red-400' : 'bg-zinc-800 text-zinc-500 hover:bg-green-900/40 hover:text-green-400'}`}>
                        {t.active ? 'Live' : 'Hidden'}
                      </button>
                      <button onClick={() => startEdit(t)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => deleteTestimonial(t.id)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg bg-zinc-800 text-red-500 hover:bg-red-900/30 transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PHOTOS ── */}
      {tab === 'photos' && (
        <div className="space-y-5">
          {/* Upload form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-white">Add event photo</h2>

            {/* Upload area */}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-zinc-700 rounded-xl p-6 text-center cursor-pointer hover:border-amber-500 transition-colors group">
              {pForm.url ? (
                <img src={resolveImageUrl(pForm.url)} alt="preview"
                  className="max-h-32 mx-auto rounded-xl object-cover" />
              ) : (
                <>
                  <div className="text-3xl mb-2">{uploading ? '⏳' : '📸'}</div>
                  <p className="text-sm text-zinc-400 group-hover:text-amber-400 transition-colors">
                    {uploading ? 'Uploading…' : 'Click to upload photo'}
                  </p>
                  <p className="text-xs text-zinc-600 mt-1">JPG, PNG, WebP — max 5MB</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Caption (optional)</label>
                <input value={pForm.caption} onChange={e => setPForm(f => ({ ...f, caption: e.target.value }))}
                  placeholder="Sunset sailing on the Bosphorus"
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Event name (optional)</label>
                <input value={pForm.event} onChange={e => setPForm(f => ({ ...f, event: e.target.value }))}
                  placeholder="Bosphorus Sailing Club"
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>

            <button onClick={savePhoto} disabled={pSaving || !pForm.url || uploading}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-40">
              {pSaving ? 'Saving…' : 'Add photo'}
            </button>
          </div>

          {/* Photo grid */}
          {pLoading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : photos.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <div className="text-4xl mb-3">📸</div>
              <p className="text-sm">No photos yet. Upload the first one above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map(p => (
                <div key={p.id} className={`relative group rounded-2xl overflow-hidden bg-zinc-800 ${!p.active ? 'opacity-40' : ''}`}>
                  <img src={resolveImageUrl(p.url)} alt={p.caption ?? ''}
                    className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-3">
                    {p.caption && <p className="text-xs text-white text-center font-medium leading-snug">{p.caption}</p>}
                    {p.event   && <p className="text-xs text-amber-400 text-center">{p.event}</p>}
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => togglePhoto(p)}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg ${p.active ? 'bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400' : 'bg-white/10 text-zinc-400 hover:bg-green-500/20 hover:text-green-400'} transition-colors`}>
                        {p.active ? 'Live' : 'Hidden'}
                      </button>
                      <button onClick={() => deletePhoto(p.id)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
