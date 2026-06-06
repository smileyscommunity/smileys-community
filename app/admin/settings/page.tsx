'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'

interface Toggle {
  id: string
  label: string
  description: string
  value: boolean
}

export default function AdminSettingsPage() {
  const [saving,   setSaving]   = useState(false)

  // Community settings — start empty so we never flash placeholder
  // copy (the old defaults included a fake "+90 555 000 0000" number
  // that briefly looked like real data on slow connections).
  const [community, setCommunity] = useState({
    name:           '',
    tagline:        '',
    description:    '',
    email:          '',
    website:        '',
    instagram:      '',
    whatsapp:       '',
    communityRules: '',
  })

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
        setCommunity(prev => ({ ...prev, ...data }))
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
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp</label>
                <input type="text" value={community.whatsapp} onChange={(e) => setCommunity((p) => ({ ...p, whatsapp: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>

            {/* Community-wide house rules. Surfaced on every club page
                above the club's own rules — sets the baseline conduct
                expectations everyone agrees to by being on Smileys. */}
            <div className="mt-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Community house rules
                <span className="text-zinc-500 font-normal"> · shown on every club page</span>
              </label>
              <textarea
                rows={6}
                maxLength={4000}
                value={community.communityRules}
                onChange={(e) => setCommunity((p) => ({ ...p, communityRules: e.target.value }))}
                placeholder={'1. Be kind — sarcasm is fine, contempt is not\n2. RSVP integrity — show up or cancel early\n3. No selling / MLM / recruiting at events\n…'}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y font-mono"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Plain text — line breaks preserved on the club page. {community.communityRules.length}/4000.
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
                    body: JSON.stringify(community),
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


      </div>
    </div>
  )
}
