'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { downscaleImage } from '@/lib/image-resize'

type Row = { category: string; label: string; emoji: string; src: string; isOverride: boolean }

export default function HandbookHeroesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  async function load() {
    try {
      const r = await fetch('/app/api/admin/handbook-heroes', { credentials: 'include' }).then(r => r.json())
      setRows(r.categories ?? [])
    } catch {
      toast.error('Could not load hero images')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function upload(category: string, file: File) {
    setBusy(category)
    try {
      const small = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', small)
      fd.append('folder', 'general')
      const up = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(r => r.json())
      if (!up?.url) { toast.error(up?.error ?? 'Upload failed'); return }
      const save = await fetch('/app/api/admin/handbook-heroes', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, src: up.url }),
      }).then(r => r.json())
      if (save?.ok) { toast.success(`${category} hero updated`); await load() }
      else toast.error(save?.error ?? 'Could not save')
    } catch {
      toast.error('Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function reset(category: string) {
    setBusy(category)
    try {
      const r = await fetch('/app/api/admin/handbook-heroes', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      }).then(r => r.json())
      if (r?.ok) { toast.success(`${category} reset to default banner`); await load() }
      else toast.error('Could not reset')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">Handbook hero images</h1>
      <p className="text-sm text-zinc-400 mb-8">
        The banner shown at the top of every article in a category. Upload a photo to replace the
        default; articles with their own cover image still use that cover.
      </p>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {rows.map(row => (
            <div key={row.category} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.src} alt={row.label} className="w-full h-40 object-cover" />
              <div className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{row.emoji} {row.label}</p>
                  <p className="text-xs text-zinc-500">{row.isOverride ? 'Custom photo' : 'Default banner'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => inputs.current[row.category]?.click()}
                    disabled={busy === row.category}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold transition-colors">
                    {busy === row.category ? 'Uploading…' : 'Replace'}
                  </button>
                  {row.isOverride && (
                    <button
                      onClick={() => reset(row.category)}
                      disabled={busy === row.category}
                      className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 text-xs font-semibold transition-colors">
                      Reset
                    </button>
                  )}
                  <input
                    ref={el => { inputs.current[row.category] = el }}
                    type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(row.category, f); e.target.value = '' }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
