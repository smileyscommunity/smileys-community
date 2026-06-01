'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

// Just the announcement banner editor. The polls editor lives at
// /admin/polls — the two used to share this route behind a ?tab=
// query param, but the tab nav stayed visible from both sidebar
// entries which made polls look like part of the announcements
// page (and vice versa). Each surface now has its own focused
// route.

interface Announcement {
  text: string
  link: string
  active: boolean
}

export default function AnnouncementsPage() {
  const [data, setData]       = useState<Announcement>({ text: '', link: '', active: false })
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/admin/announcement', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/announcement', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to save announcement')
        return
      }
      toast.success(data.active ? 'Announcement published' : 'Announcement hidden')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Announcements</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Top-of-page banner shown to every logged-in member.</p>
      </div>

      {loading ? (
        // Page-shape skeleton matching the form layout.
        <div className="max-w-xl space-y-5">
          <div className="h-3 w-3/4 rounded bg-zinc-800 animate-pulse" />
          <div className="space-y-2">
            <div className="h-3 w-20 rounded bg-zinc-800/60 animate-pulse" />
            <div className="h-12 rounded-xl bg-zinc-800 animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-zinc-800/60 animate-pulse" />
            <div className="h-12 rounded-xl bg-zinc-800 animate-pulse" />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="h-6 w-32 rounded bg-zinc-800 animate-pulse" />
            <div className="h-9 w-20 rounded-xl bg-zinc-800 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="max-w-xl space-y-5">
          <p className="text-sm text-zinc-400">
            This banner appears at the top of every page for all logged-in members.
          </p>

          {/* Preview */}
          {data.text && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${data.active ? 'bg-amber-500/15 border border-amber-500/25 text-amber-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-400'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${data.active ? 'bg-amber-500' : 'bg-zinc-600'}`} />
              <span className="flex-1">{data.text}</span>
              {data.link && <span className="text-xs opacity-60 shrink-0">→ {data.link}</span>}
            </div>
          )}

          {/* Fields */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Message</label>
            <input
              value={data.text}
              onChange={e => setData(d => ({ ...d, text: e.target.value }))}
              maxLength={300}
              placeholder="e.g. Our next big event is this Saturday — don't miss it!"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <p className="text-right text-xs text-zinc-600 mt-1">{data.text.length}/300</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Link <span className="text-zinc-600 normal-case font-normal">(optional)</span></label>
            <input
              value={data.link}
              onChange={e => setData(d => ({ ...d, link: e.target.value }))}
              placeholder="/events or https://..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setData(d => ({ ...d, active: !d.active }))}
                className={`w-11 h-6 rounded-full transition-colors relative ${data.active ? 'bg-amber-500' : 'bg-zinc-700'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${data.active ? 'translate-x-6' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm text-zinc-300">{data.active ? 'Visible to members' : 'Hidden'}</span>
            </label>

            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
