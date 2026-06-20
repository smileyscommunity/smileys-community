'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'

interface Toggle {
  id: string
  label: string
  description: string
  value: boolean
}

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
        if (data.pricing)       setPricing(p => ({ ...p, ...data.pricing }))
        if (data.notifications) setNotifications(p => ({ ...p, ...data.notifications }))
        if (data.toggles)       setToggles(prev => prev.map(t => ({ ...t, value: data.toggles[t.id] ?? t.value })))
      })
      .catch(() => toast.error('Network error — could not load settings'))
  }, [])

  // Membership pricing
  const [pricing, setPricing] = useState({
    monthlyPrice:  '299',
    yearlyPrice:   '2490',
    trialDays:     '7',
    currency:      '₺',
  })

  // Feature toggles
  const [toggles, setToggles] = useState<Toggle[]>([
    { id: 'whatsapp_button',   label: 'WhatsApp Group Button',    description: 'Show "Join WhatsApp Group" on event pages',    value: true  },
    { id: 'persistent_cta',   label: 'Persistent CTA Bar',       description: 'Fixed bottom bar with Join + Explore buttons',  value: true  },
    { id: 'member_pricing',   label: 'Member Pricing',           description: 'Show discounted pricing for members',           value: true  },
    { id: 'friends_section',  label: 'Friends Going Section',    description: 'Show friends attending on event pages',         value: true  },
    { id: 'vibe_tags',        label: 'Vibe Tags',                description: 'Display vibe tags on events and cards',         value: true  },
    { id: 'onboarding',       label: 'Onboarding Flow',          description: 'Enable the 6-step onboarding for new users',    value: true  },
    { id: 'premium_events',   label: 'Premium Events',           description: 'Allow events to be marked as premium',          value: true  },
    { id: 'members_only',     label: 'Members-Only Events',      description: 'Allow events to be restricted to members',      value: false },
  ])

  // Notification settings
  const [notifications, setNotifications] = useState({
    newMember:     true,
    newBooking:    true,
    eventReminder: true,
    lowCapacity:   true,
    weeklyDigest:  false,
  })


  async function flipToggle(id: string) {
    // Optimistic flip with rollback. Previously the await result was
    // discarded — a 403/500/network drop left the UI showing the new
    // state even though the server kept the old value, and the next
    // page load would "mysteriously" revert it.
    const prev = toggles
    const updated = toggles.map(t => t.id === id ? { ...t, value: !t.value } : t)
    setToggles(updated)
    const toggleMap = Object.fromEntries(updated.map(t => [t.id, t.value]))
    try {
      const res = await fetch('/app/api/admin/settings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toggles: toggleMap }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setToggles(prev)
        toast.error(d?.error ?? 'Failed to save toggle')
      }
    } catch {
      setToggles(prev)
      toast.error('Network error — toggle not saved')
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

        {/* Membership pricing */}
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-white font-bold mb-5">Membership Pricing</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Monthly price ({pricing.currency})</label>
              <input
                type="number"
                value={pricing.monthlyPrice}
                onChange={(e) => setPricing((p) => ({ ...p, monthlyPrice: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Yearly price ({pricing.currency})</label>
              <input
                type="number"
                value={pricing.yearlyPrice}
                onChange={(e) => setPricing((p) => ({ ...p, yearlyPrice: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Free trial (days)</label>
              <input
                type="number"
                value={pricing.trialDays}
                onChange={(e) => setPricing((p) => ({ ...p, trialDays: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Currency</label>
              <select
                value={pricing.currency}
                onChange={(e) => setPricing((p) => ({ ...p, currency: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="₺">₺ Turkish Lira</option>
                <option value="$">$ US Dollar</option>
                <option value="€">€ Euro</option>
              </select>
            </div>
          </div>
          <button onClick={async () => {
            setSaving(true)
            try {
              const res = await fetch('/app/api/admin/settings', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pricing }),
              })
              if (res.ok) {
                toast.success('Pricing saved ✓')
              } else {
                const d = await res.json().catch(() => ({}))
                toast.error(d?.error ?? 'Failed to save')
              }
            } catch {
              toast.error('Network error — not saved')
            } finally {
              setSaving(false)
            }
          }} disabled={saving} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save pricing'}
          </button>
        </section>

        {/* Feature toggles */}
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-white font-bold mb-5">Feature Flags</h2>
          <div className="space-y-3">
            {toggles.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-zinc-800 last:border-0">
                <div>
                  <div className="text-sm font-semibold text-zinc-200">{t.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{t.description}</div>
                </div>
                <button
                  onClick={() => flipToggle(t.id)}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ml-4 ${
                    t.value ? 'bg-amber-500' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                      t.value ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Notifications */}
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-white font-bold mb-5">Admin Notifications</h2>
          <div className="space-y-3">
            {(Object.entries(notifications) as [keyof typeof notifications, boolean][]).map(([key, val]) => {
              const labels: Record<string, string> = {
                newMember:     'New member signup',
                newBooking:    'New event booking',
                eventReminder: 'Event reminders (48h before)',
                lowCapacity:   'Low spots alert (≤ 5 left)',
                weeklyDigest:  'Weekly performance digest',
              }
              return (
                <div key={key} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                  <span className="text-sm text-zinc-300">{labels[key]}</span>
                  <button
                    onClick={() => setNotifications((p) => ({ ...p, [key]: !p[key] }))}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
                      val ? 'bg-amber-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                        val ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="mt-5">
            <button onClick={async () => {
              setSaving(true)
              try {
                const res = await fetch('/app/api/admin/settings', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ notifications }),
                })
                if (res.ok) {
                  toast.success('Preferences saved ✓')
                } else {
                  const d = await res.json().catch(() => ({}))
                  toast.error(d?.error ?? 'Failed to save')
                }
              } catch {
                toast.error('Network error — not saved')
              } finally {
                setSaving(false)
              }
            }} disabled={saving} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save preferences'}
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
