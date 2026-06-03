'use client'

import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

// Just the announcement banner editor. The polls editor lives at
// /admin/polls — the two used to share this route behind a ?tab=
// query param, but the tab nav stayed visible from both sidebar
// entries which made polls look like part of the announcements
// page (and vice versa). Each surface now has its own focused
// route.

interface Announcement {
  text:      string
  link:      string
  active:    boolean
  updatedAt: string | null
  updatedBy: string | null
}

const EMPTY: Announcement = {
  text:      '',
  link:      '',
  active:    false,
  updatedAt: null,
  updatedBy: null,
}

const LINK_MAX = 2000

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60)   return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

// Mirrors the server's lib/safeUrl.ts isSafeHref so the admin sees the
// validation error inline instead of submitting and getting a 400. Keep
// this in sync if the server-side allowlist tightens.
function clientLinkLooksValid(link: string): boolean {
  if (!link) return true
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f]/.test(link)) return false
  if (link.startsWith('//')) return false
  if (link.startsWith('/')) return true
  return /^https:\/\//i.test(link)
}

export default function AnnouncementsPage() {
  // Shared admin-load hook handles the GET + r.ok + retry. We
  // hydrate the form's editable copy from `loaded` once it lands.
  const { data: loaded, loading, error, retry } = useAdminLoad<Announcement>(
    '/app/api/admin/announcement',
    (v): v is Announcement => !!v && typeof v === 'object' && 'text' in v && 'active' in v,
  )
  const [data,     setData]     = useState<Announcement>(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [hydrated, setHydrated] = useState(false)
  // Hydrate the form ONCE so the user's in-flight edits don't get
  // clobbered if useAdminLoad re-fires (e.g. user clicks retry while
  // typing).
  useEffect(() => {
    if (loaded && !hydrated) {
      setData(loaded)
      setHydrated(true)
    }
  }, [loaded, hydrated])

  // Disable save when there's nothing to save. Compares the editable
  // fields only — updatedAt/updatedBy are server-set on every write.
  const dirty = useMemo(() => {
    if (!loaded) return false
    return data.text   !== loaded.text
        || data.link   !== loaded.link
        || data.active !== loaded.active
  }, [data, loaded])

  const linkValid = clientLinkLooksValid(data.link.trim())

  async function save() {
    if (!dirty || !linkValid) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/announcement', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.text, link: data.link, active: data.active }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to save announcement')
        return
      }
      const d = await res.json().catch(() => ({}))
      // Sync the local copy with server-stamped fields so `dirty`
      // resets and the "Last edited" line updates without a refetch.
      setData(prev => ({
        ...prev,
        updatedAt: d.updatedAt ?? new Date().toISOString(),
        updatedBy: d.updatedBy ?? prev.updatedBy,
      }))
      toast.success(data.active ? 'Announcement published' : 'Announcement hidden')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Announcements</h1>
        {/* Was previously: "Top-of-page banner shown to every logged-in
            member." The banner only renders on the dashboard left
            sidebar (app/(member)/dashboard/page.tsx). Don't overstate
            reach — moderators will write copy for the wrong audience. */}
        <p className="text-sm text-zinc-500 mt-0.5">Banner shown on the member dashboard.</p>
      </div>

      <LoadErrorBanner message={error} onRetry={retry} title="Couldn't load announcement" className="mb-6" />

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
          {/* Preview */}
          {data.text && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${data.active ? 'bg-amber-500/15 border border-amber-500/25 text-amber-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-400'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${data.active ? 'bg-amber-500' : 'bg-zinc-600'}`} />
              <span className="flex-1">{data.text}</span>
              {data.link && <span className="text-xs opacity-60 shrink-0 truncate max-w-[40%]">→ {data.link}</span>}
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
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">
              Link <span className="text-zinc-600 normal-case font-normal">(optional)</span>
            </label>
            <input
              value={data.link}
              onChange={e => setData(d => ({ ...d, link: e.target.value }))}
              maxLength={LINK_MAX}
              placeholder="/events or https://..."
              className={`w-full bg-zinc-800 border rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 ${
                linkValid ? 'border-zinc-700 focus:ring-amber-500' : 'border-red-500/50 focus:ring-red-500'
              }`}
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-red-400">
                {linkValid ? '' : 'Must be a relative path (/path) or an https:// URL'}
              </p>
              <p className="text-xs text-zinc-600">{data.link.length}/{LINK_MAX}</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            {/* Real <input type="checkbox"> wrapped by the label so
                clicking the label text toggles too. Previously the
                label wrapped a div onClick with no input association,
                so clicking the "Visible to members" text did nothing
                despite cursor-pointer. */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={data.active}
                onChange={e => setData(d => ({ ...d, active: e.target.checked }))}
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className="w-11 h-6 rounded-full transition-colors relative bg-zinc-700 peer-checked:bg-amber-500"
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${data.active ? 'translate-x-6' : 'translate-x-1'}`} />
              </span>
              <span className="text-sm text-zinc-300">{data.active ? 'Visible to members' : 'Hidden'}</span>
            </label>

            <button
              onClick={save}
              disabled={saving || !dirty || !linkValid}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>

          {/* Last-edited audit line — surfaces the server-set
              updatedAt + updatedBy so moderators can see whose
              announcement is currently live. */}
          {data.updatedAt && (
            <p className="text-xs text-zinc-600 pt-1">
              Last edited {timeAgo(data.updatedAt)}
              {data.updatedBy ? ` by ${data.updatedBy}` : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
