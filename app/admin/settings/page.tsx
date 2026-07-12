'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'

// Matches CommunityRule in lib/communitySettings.ts. Kept inline (not
// imported) because this file is a client component and the loader
// uses fs/node imports.
interface Rule { icon?: string; title: string; body: string }
const RULES_MAX_COUNT = 12

export default function AdminSettingsPage() {
  const [saving,   setSaving]   = useState(false)

  // Community settings — start empty so we never flash placeholder
  // copy (the old defaults included a fake "+90 555 000 0000" number
  // that briefly looked like real data on slow connections).
  const [community, setCommunity] = useState({
    name:        '',
    tagline:     '',
    description: '',
    email:       '',
    website:     '',
    instagram:   '',
    whatsapp:    '',
  })
  // Rules live in their own state slot because they're a separate
  // shape (array of objects) and have their own editor with
  // per-rule add/remove/reorder handlers.
  const [rules, setRules] = useState<Rule[]>([])

  useEffect(() => {
    fetch('/app/api/admin/settings', { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          toast.error(d?.error ?? `Couldn't load settings (HTTP ${r.status})`)
          return null
        }
        const d = await r.json()
        return (d && typeof d === 'object' && !d.error) ? d : null
      })
      .then(data => {
        if (!data) return
        const { communityRules, ...rest } = data
        setCommunity(prev => ({ ...prev, ...rest }))
        // Coerce: array → use as-is, anything else (legacy string /
        // undefined / null) → empty.
        setRules(Array.isArray(communityRules) ? communityRules : [])
        if (typeof data.applicationsOpen === 'boolean') setApplicationsOpen(data.applicationsOpen)
      })
      .catch(() => toast.error('Network error — could not load settings'))
  }, [])

  // Membership intake switch — the one real toggle. When off, the apply page
  // shows a closed notice and the submit API rejects. Default: open.
  const [applicationsOpen, setApplicationsOpen] = useState(true)

  async function flipApplications() {
    // Optimistic flip with rollback so a failed save doesn't leave the UI
    // lying about whether intake is open.
    const next = !applicationsOpen
    setApplicationsOpen(next)
    try {
      const res = await fetch('/app/api/admin/settings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationsOpen: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setApplicationsOpen(!next)
        toast.error(d?.error ?? 'Failed to save')
      } else {
        toast.success(next ? 'Applications opened ✓' : 'Applications paused')
      }
    } catch {
      setApplicationsOpen(!next)
      toast.error('Network error — not saved')
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">

      <div>
        <h1 className="text-white text-2xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage community configuration and preferences</p>
      </div>

      <div className="space-y-6">

        {/* Community info */}
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-white font-bold mb-5">Community Info</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Community name</label>
                <input
                  type="text"
                  value={community.name}
                  onChange={(e) => setCommunity((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Contact email</label>
                <input
                  type="email"
                  value={community.email}
                  onChange={(e) => setCommunity((p) => ({ ...p, email: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Tagline</label>
              <input
                type="text"
                value={community.tagline}
                onChange={(e) => setCommunity((p) => ({ ...p, tagline: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
              <textarea
                rows={2}
                value={community.description}
                onChange={(e) => setCommunity((p) => ({ ...p, description: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Website</label>
                <input type="text" value={community.website} onChange={(e) => setCommunity((p) => ({ ...p, website: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Instagram</label>
                <input type="text" value={community.instagram} onChange={(e) => setCommunity((p) => ({ ...p, instagram: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp Channel URL</label>
                <input type="url" value={community.whatsapp} onChange={(e) => setCommunity((p) => ({ ...p, whatsapp: e.target.value }))}
                  placeholder="https://whatsapp.com/channel/0029Va…"
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Paste the full channel link (a broadcast channel, not a phone number).
                </p>
              </div>
            </div>

            {/* Community-wide house rules. Surfaced on every club page
                above the club's own rules — sets the baseline conduct
                expectations everyone agrees to by being on Smileys.
                Structured per-rule (icon + title + body) so the club
                page can render them as scannable cards instead of a
                wall of text. */}
            <div className="mt-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Community house rules
                <span className="text-zinc-500 font-normal"> · shown on every club page</span>
              </label>

              <div className="space-y-3">
                {rules.length === 0 && (
                  <p className="text-xs text-zinc-500 italic">
                    No rules yet. Add the first one below.
                  </p>
                )}
                {rules.map((r, i) => (
                  <div key={i} className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-zinc-500 w-6">#{i + 1}</span>
                      <input
                        type="text"
                        value={r.icon ?? ''}
                        onChange={(e) => setRules(prev => prev.map((x, j) => j === i ? { ...x, icon: e.target.value } : x))}
                        placeholder="🤝"
                        maxLength={8}
                        className="w-14 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-center text-base focus:outline-none focus:ring-2 focus:ring-amber-500"
                        aria-label={`Rule ${i + 1} icon`}
                      />
                      <input
                        type="text"
                        value={r.title}
                        onChange={(e) => setRules(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                        placeholder="Short headline (e.g. Be kind)"
                        maxLength={60}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        aria-label={`Rule ${i + 1} title`}
                      />
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => setRules(prev => {
                            const next = [...prev]
                            ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                            return next
                          })}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Move up"
                        >↑</button>
                        <button
                          type="button"
                          disabled={i === rules.length - 1}
                          onClick={() => setRules(prev => {
                            const next = [...prev]
                            ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                            return next
                          })}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Move down"
                        >↓</button>
                        <button
                          type="button"
                          onClick={() => setRules(prev => prev.filter((_, j) => j !== i))}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:bg-red-500/20 hover:text-red-400"
                          aria-label="Remove rule"
                        >×</button>
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      value={r.body}
                      onChange={(e) => setRules(prev => prev.map((x, j) => j === i ? { ...x, body: e.target.value } : x))}
                      placeholder="One or two sentences explaining the rule."
                      maxLength={280}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                      aria-label={`Rule ${i + 1} body`}
                    />
                    <p className="text-[10px] text-zinc-500 text-right">
                      {r.body.length}/280
                    </p>
                  </div>
                ))}
              </div>

              {rules.length < RULES_MAX_COUNT && (
                <button
                  type="button"
                  onClick={() => setRules(prev => [...prev, { icon: '', title: '', body: '' }])}
                  className="mt-3 w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-zinc-700 hover:border-amber-500 text-xs font-semibold text-zinc-400 hover:text-amber-400 transition-colors"
                >
                  + Add rule
                </button>
              )}
              <p className="text-[10px] text-zinc-500 mt-2">
                Max {RULES_MAX_COUNT} rules. Icons optional — numbered fallback when blank. Empty rules are dropped on save.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  const res = await fetch('/app/api/admin/settings', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...community, communityRules: rules }),
                  })
                  if (res.ok) {
                    toast.success('Community info saved ✓')
                  } else {
                    const d = await res.json().catch(() => ({}))
                    toast.error(d?.error ?? 'Failed to save')
                  }
                } catch {
                  toast.error('Network error — not saved')
                } finally {
                  setSaving(false)
                }
              }}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </section>

        {/* Applications intake — the one real toggle. */}
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-white font-bold mb-1">Applications</h2>
          <p className="text-xs text-zinc-500 mb-5">
            Pause new member applications when you&apos;re at capacity or curating. When off, the apply page shows a closed notice and submissions are rejected.
          </p>
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-semibold text-zinc-200">Accepting applications</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {applicationsOpen ? 'The apply page is open to new members.' : 'The apply page shows “applications closed”.'}
              </div>
            </div>
            <button
              onClick={flipApplications}
              role="switch"
              aria-checked={applicationsOpen}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ml-4 ${
                applicationsOpen ? 'bg-amber-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                  applicationsOpen ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </section>

        {/* System tools */}
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-4">System tools</h2>
          <div className="space-y-3">
            <SystemTool
              label="Login nudge"
              description="Send activation reminder emails to approved members who have never logged in (max 2 per member, 7-day cooldown)."
              endpoint="/app/api/admin/tools/login-nudge"
              successMsg={r => `Sent ${r.sent} nudge${r.sent !== 1 ? 's' : ''}${r.failed ? ` · ${r.failed} failed` : ''} (${r.candidates} eligible)`}
            />
          </div>
        </section>

      </div>
    </div>
  )
}

function SystemTool({ label, description, endpoint, successMsg }: {
  label: string
  description: string
  endpoint: string
  successMsg: (r: any) => string
}) {
  const [running, setRunning] = useState(false)
  async function run() {
    setRunning(true)
    try {
      const res  = await fetch(endpoint, { method: 'POST', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Failed'); return }
      toast.success(successMsg(data))
    } catch {
      toast.error('Network error')
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-800 last:border-0">
      <div>
        <div className="text-sm font-semibold text-zinc-200">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{description}</div>
      </div>
      <button onClick={run} disabled={running}
        className="shrink-0 ml-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-50 transition-colors">
        {running ? 'Running…' : 'Run now'}
      </button>
    </div>
  )
}
