'use client'

import { useState } from 'react'
import Link from 'next/link'
import { use } from 'react'
import { events, getEventById, clubs, hosts, vibeConfig, VibeTag } from '@/lib/data'

const VIBES  = Object.keys(vibeConfig) as VibeTag[]
const EMOJIS = ['⛵', '🍽️', '💬', '🎵', '🌿', '🎭', '🏃', '🎨', '🍷', '🧘', '🥾', '🎤']

export function generateStaticParams() {
  return events.map((e) => ({ id: e.id }))
}

export default function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const event  = getEventById(id)

  const [form, setForm] = useState({
    title:        event?.title        ?? '',
    date:         event?.date         ?? '',
    time:         event?.time         ?? '',
    location:     event?.location     ?? '',
    neighborhood: event?.neighborhood ?? '',
    clubId:       event?.clubId       ?? '',
    hostId:       event?.hostId       ?? '',
    description:  event?.description  ?? '',
    totalSpots:   String(event?.totalSpots   ?? 20),
    price:        String(event?.price        ?? 0),
    memberPrice:  String(event?.memberPrice  ?? ''),
    emoji:        event?.emoji        ?? '🎉',
    isPremium:    event?.isPremium    ?? false,
    membersOnly:  event?.membersOnly  ?? false,
    limitedSpots: event?.limitedSpots ?? true,
  })
  const [selectedVibes, setSelectedVibes] = useState<VibeTag[]>(event?.vibes ?? [])
  const [saved, setSaved] = useState(false)

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleVibe(v: VibeTag) {
    setSelectedVibes((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])
  }

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!event) {
    return (
      <div className="p-8">
        <p className="text-zinc-400">Event not found.</p>
        <Link href="/admin/events" className="text-amber-400 text-sm mt-2 inline-block">← Back to events</Link>
      </div>
    )
  }

  const inputCls = "w-full px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20"

  return (
    <div className="p-8 max-w-3xl">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/admin/events" className="text-zinc-600 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{form.emoji}</span>
            <h1 className="text-2xl font-bold text-white tracking-tight">{form.title || 'Edit event'}</h1>
          </div>
          <p className="text-xs text-zinc-600 mt-0.5">ID: {event.id}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href={`/events/${event.id}`} target="_blank"
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
            View public →
          </Link>
          <Link href={`/admin/events/${event.id}/participants`}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">
            👥 Participants
          </Link>
        </div>
      </div>

      {saved && (
        <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Changes saved (UI only — no data persisted)
        </div>
      )}

      <div className="space-y-4">

        {/* Basic info */}
        <section className="bg-zinc-900 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5">Basic info</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Event title</label>
              <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Description</label>
              <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)}
                className={`${inputCls} resize-none`} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">Club</label>
                <select value={form.clubId} onChange={(e) => set('clubId', e.target.value)} className={inputCls}>
                  {clubs.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">Host</label>
                <select value={form.hostId} onChange={(e) => set('hostId', e.target.value)} className={inputCls}>
                  {Object.values(hosts).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* When & where */}
        <section className="bg-zinc-900 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5">When & where</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Date</label>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Time</label>
              <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Venue</label>
              <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Neighborhood</label>
              <input type="text" value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} className={inputCls} />
            </div>
          </div>
        </section>

        {/* Capacity & pricing */}
        <section className="bg-zinc-900 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5">Capacity & pricing</h2>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Total spots</label>
              <input type="number" min="1" value={form.totalSpots} onChange={(e) => set('totalSpots', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Guest price (₺)</label>
              <input type="number" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Member price (₺)</label>
              <input type="number" min="0" value={form.memberPrice} onChange={(e) => set('memberPrice', e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <div className="flex flex-wrap gap-5">
            {[
              { key: 'limitedSpots', label: 'Limited spots'   },
              { key: 'isPremium',    label: '♛ Premium event' },
              { key: 'membersOnly',  label: '🔒 Members only' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[key as keyof typeof form] as boolean}
                  onChange={(e) => set(key, e.target.checked)}
                  className="w-4 h-4 rounded accent-white"
                />
                <span className="text-sm text-zinc-300">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Vibe */}
        <section className="bg-zinc-900 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5">Vibe</h2>
          <div className="flex flex-wrap gap-2">
            {VIBES.map((vibe) => {
              const cfg    = vibeConfig[vibe]
              const active = selectedVibes.includes(vibe)
              return (
                <button key={vibe} onClick={() => toggleVibe(vibe)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all ${
                    active
                      ? `${cfg.bg} ${cfg.text} ${cfg.border}`
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white'
                  }`}>
                  {cfg.emoji} {vibe}
                </button>
              )
            })}
          </div>
        </section>

        {/* Emoji */}
        <section className="bg-zinc-900 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5">Event emoji</h2>
          <div className="flex flex-wrap gap-3">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => set('emoji', e)}
                className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all ${
                  form.emoji === e
                    ? 'bg-white/10 ring-2 ring-white scale-110'
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}>
                {e}
              </button>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center justify-between pb-4">
          <button className="text-sm px-4 py-2.5 rounded-xl text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors">
            Delete event
          </button>
          <div className="flex gap-3">
            <Link href="/admin/events"
              className="text-sm px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
              Cancel
            </Link>
            <button onClick={handleSave}
              className="text-sm px-8 py-2.5 rounded-xl bg-white text-black font-semibold hover:bg-zinc-100 transition-colors">
              Save changes
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
