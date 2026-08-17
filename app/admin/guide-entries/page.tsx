'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { moodsFor, collectionsFor, seasonsFor, type GuideTaxon } from '@/lib/guide'

// Guide phase 2.3b — the editor for guide experiences.
//
// Until this page existed, entries could only be created by running a script on
// the server, which meant the Bodrum guide's content was blocked on an engineer
// and the six seeded history drafts had no way to be finished. Editorial content
// should never need a deploy.
//
// The taxonomy selects come from lib/guide.ts per city, so an editor is offered
// Bodrum's verbs on Bodrum entries and Istanbul's on Istanbul's. The server
// validates the same lists — see lib/guideEntryInput.ts — and refuses to publish
// an entry with no Smileys Take.

interface Section { title: string; items: string[] }

interface Entry {
  id: string
  cityId: string
  slug: string
  title: string
  emoji: string
  tagline: string
  collection: string | null
  moods: string[]
  seasons: string[]
  cost: string | null
  time: string | null
  when: string | null
  neighborhoods: string[]
  firstTime: boolean
  content: { why?: string; take?: string; sections?: Section[] } | null
  status: string
  sortOrder: number
  city: { slug: string; name: string }
}

interface City { id: string; slug: string; name: string; status: string }

type Draft = {
  slug: string; title: string; emoji: string; tagline: string
  collection: string; moods: string[]; seasons: string[]
  cost: string; time: string; when: string
  neighborhoods: string[]; firstTime: boolean
  why: string; take: string; sections: Section[]
  status: 'draft' | 'published'; sortOrder: number
}

const emptyDraft = (): Draft => ({
  slug: '', title: '', emoji: '✨', tagline: '', collection: '', moods: [], seasons: [],
  cost: '', time: '', when: '', neighborhoods: [], firstTime: false,
  why: '', take: '', sections: [], status: 'draft', sortOrder: 0,
})

const toDraft = (e: Entry): Draft => ({
  slug: e.slug, title: e.title, emoji: e.emoji, tagline: e.tagline,
  collection: e.collection ?? '', moods: e.moods ?? [], seasons: e.seasons ?? [],
  cost: e.cost ?? '', time: e.time ?? '', when: e.when ?? '',
  neighborhoods: e.neighborhoods ?? [], firstTime: e.firstTime,
  why: e.content?.why ?? '', take: e.content?.take ?? '',
  sections: e.content?.sections ?? [],
  status: e.status === 'published' ? 'published' : 'draft',
  sortOrder: e.sortOrder,
})

const slugify = (s: string) =>
  s.toLowerCase().trim()
    .replace(/[çğıöşü]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c] ?? c))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function AdminGuideEntriesPage() {
  const [cities,  setCities]  = useState<City[]>([])
  const [citySlug, setCitySlug] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [hoods,   setHoods]   = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [editing, setEditing] = useState<string | null>(null)   // entry id, or 'new'
  const [draft,   setDraft]   = useState<Draft>(emptyDraft())

  const moods:       GuideTaxon[] = citySlug ? moodsFor(citySlug) : []
  const collections: GuideTaxon[] = citySlug ? collectionsFor(citySlug) : []
  const seasons                   = citySlug ? seasonsFor(citySlug) : []

  const load = useCallback(async (slug?: string) => {
    setLoading(true)
    try {
      const qs = slug ? `?city=${encodeURIComponent(slug)}` : ''
      const r = await fetch(`/app/api/admin/guide-entries${qs}`, { credentials: 'include' })
      if (!r.ok) { toast.error('Could not load guide entries'); return }
      const d = await r.json()
      setCities(d.cities ?? [])
      setEntries(d.entries ?? [])
      if (!slug && !citySlug && d.cities?.length) setCitySlug(d.cities[0].slug)
    } finally {
      setLoading(false)
    }
  }, [citySlug])

  useEffect(() => { load() }, [])                             // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (citySlug) load(citySlug) }, [citySlug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Neighborhood options come from the city's registry — the same list the
  // server validates against, so the form can't offer an invalid choice.
  useEffect(() => {
    if (!citySlug) return
    fetch(`/app/api/neighborhoods?city=${encodeURIComponent(citySlug)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { neighborhoods: [] })
      .then(d => setHoods(((d.neighborhoods ?? []) as { name: string }[]).map(n => n.name)))
      .catch(() => setHoods([]))
  }, [citySlug])

  function startNew() {
    setDraft({ ...emptyDraft(), sortOrder: (entries.at(-1)?.sortOrder ?? 0) + 10 })
    setEditing('new')
  }

  function startEdit(e: Entry) {
    setDraft(toDraft(e))
    setEditing(e.id)
  }

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v]

  async function save() {
    setSaving(true)
    try {
      const isNew = editing === 'new'
      const r = await fetch(isNew ? '/app/api/admin/guide-entries' : `/app/api/admin/guide-entries/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { ...draft, citySlug } : draft),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error ?? 'Save failed'); return }
      toast.success(isNew ? 'Entry created' : 'Entry saved')
      setEditing(null)
      await load(citySlug)
    } finally {
      setSaving(false)
    }
  }

  async function remove(e: Entry) {
    const ok = await confirmToast(`Delete "${e.title}"? This can't be undone.`)
    if (!ok) return
    const r = await fetch(`/app/api/admin/guide-entries/${e.id}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) { toast.error('Delete failed'); return }
    toast.success('Deleted')
    await load(citySlug)
  }

  const published = entries.filter(e => e.status === 'published').length
  const takeless  = entries.filter(e => !e.content?.take?.trim())

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Guide experiences</h1>
          <p className="text-sm text-gray-600 mt-1">
            {loading ? 'Loading…' : `${entries.length} in ${citySlug || 'all cities'} · ${published} published`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={citySlug} onChange={e => setCitySlug(e.target.value)} className="input w-auto">
            {cities.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <button onClick={startNew} className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors">
            New experience
          </button>
        </div>
      </div>

      {/* The Take is the guide's premise, so a missing one is worth surfacing
          rather than leaving to be discovered at publish time. */}
      {takeless.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-bold">{takeless.length}</span> {takeless.length === 1 ? 'entry has' : 'entries have'} no Smileys Take yet
          — they can&apos;t be published until they do.
        </div>
      )}

      {editing && (
        <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
              {editing === 'new' ? `New experience in ${citySlug}` : 'Editing experience'}
            </span>
            <button onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[80px_1fr] gap-3 mb-3">
            <div>
              <label className="label">Emoji</label>
              <input value={draft.emoji} onChange={e => setDraft(d => ({ ...d, emoji: e.target.value }))} className="input text-center" />
            </div>
            <div>
              <label className="label">Title</label>
              <input value={draft.title}
                onChange={e => setDraft(d => ({
                  ...d,
                  title: e.target.value,
                  // Only auto-fill the slug for a new entry: changing a live
                  // entry's slug breaks every link already shared.
                  slug: editing === 'new' && (!d.slug || d.slug === slugify(d.title)) ? slugify(e.target.value) : d.slug,
                }))}
                className="input" placeholder="Take a boat into the bays" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="label">Slug</label>
              <input value={draft.slug} onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))} className="input font-mono text-xs" />
              {editing !== 'new' && (
                <p className="text-[11px] text-gray-500 mt-1">Changing this breaks links already shared.</p>
              )}
            </div>
            <div>
              <label className="label">Collection (shelf)</label>
              <select value={draft.collection} onChange={e => setDraft(d => ({ ...d, collection: e.target.value }))} className="input">
                <option value="">Pick a shelf…</option>
                {collections.map(c => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="label">Tagline (card copy)</label>
            <input value={draft.tagline} onChange={e => setDraft(d => ({ ...d, tagline: e.target.value }))}
              className="input" placeholder="See Bodrum from the sea." />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {([['cost', 'Cost', '₺₺'], ['time', 'Time', 'Half a day'], ['when', 'When to go', 'Summer mornings']] as const).map(([k, label, ph]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} className="input" placeholder={ph} />
              </div>
            ))}
          </div>

          <div className="mb-4">
            <label className="label">Moods</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {moods.map(m => (
                <button key={m.value} type="button" onClick={() => setDraft(d => ({ ...d, moods: toggle(d.moods, m.value) }))}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    draft.moods.includes(m.value)
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300'}`}>
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="label">Seasons <span className="font-normal text-gray-500">— leave empty for all year</span></label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {seasons.map(s => (
                <button key={s.value} type="button" onClick={() => setDraft(d => ({ ...d, seasons: toggle(d.seasons, s.value) }))}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    draft.seasons.includes(s.value)
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300'}`}>
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          </div>

          {hoods.length > 0 && (
            <div className="mb-4">
              <label className="label">Neighborhoods <span className="font-normal text-gray-500">— drives &quot;Explore nearby&quot;</span></label>
              <div className="flex flex-wrap gap-1.5 mt-1 max-h-32 overflow-y-auto">
                {hoods.map(n => (
                  <button key={n} type="button" onClick={() => setDraft(d => ({ ...d, neighborhoods: toggle(d.neighborhoods, n) }))}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      draft.neighborhoods.includes(n)
                        ? 'bg-gray-900 border-gray-900 text-white'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="label">Why go</label>
            <textarea value={draft.why} onChange={e => setDraft(d => ({ ...d, why: e.target.value }))}
              rows={4} className="input resize-y" placeholder="What this actually is, and why it's worth the trip." />
          </div>

          <div className="mb-4">
            <label className="label">
              💛 The Smileys Take <span className="font-normal text-gray-500">— required to publish</span>
            </label>
            <textarea value={draft.take} onChange={e => setDraft(d => ({ ...d, take: e.target.value }))}
              rows={3} className="input resize-y"
              placeholder="Short, opinionated, honest — what you'd actually tell a friend." />
            <p className="text-[11px] text-gray-500 mt-1">
              This is the line that makes the Guide worth reading instead of a search result.
            </p>
          </div>

          {/* Sections — the structured "how to do it" / "good to know" blocks. */}
          <div className="mb-4">
            <label className="label">Sections</label>
            <div className="space-y-3 mt-1">
              {draft.sections.map((sec, i) => (
                <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input value={sec.title}
                      onChange={e => setDraft(d => ({ ...d, sections: d.sections.map((s, j) => j === i ? { ...s, title: e.target.value } : s) }))}
                      className="input text-sm font-semibold" placeholder="Good to know" />
                    <button type="button" onClick={() => setDraft(d => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }))}
                      className="text-xs text-red-500 hover:text-red-700 shrink-0 px-2">Remove</button>
                  </div>
                  <textarea value={sec.items.join('\n')}
                    onChange={e => setDraft(d => ({ ...d, sections: d.sections.map((s, j) => j === i ? { ...s, items: e.target.value.split('\n') } : s) }))}
                    rows={3} className="input text-sm resize-y" placeholder="One item per line" />
                </div>
              ))}
              <button type="button" onClick={() => setDraft(d => ({ ...d, sections: [...d.sections, { title: '', items: [] }] }))}
                className="text-xs font-bold text-amber-600 hover:text-amber-700">+ Add a section</button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4 mb-5">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={draft.firstTime} onChange={e => setDraft(d => ({ ...d, firstTime: e.target.checked }))} />
              First-timer essential
            </label>
            <div>
              <label className="label">Sort</label>
              <input type="number" value={draft.sortOrder} onChange={e => setDraft(d => ({ ...d, sortOrder: Number(e.target.value) }))}
                className="input w-24" />
            </div>
            <div>
              <label className="label">Status</label>
              <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as Draft['status'] }))} className="input w-auto">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : editing === 'new' ? 'Create' : 'Save changes'}
            </button>
            <button onClick={() => setEditing(null)} disabled={saving}
              className="px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-100 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <span className="text-xl shrink-0" aria-hidden="true">{e.emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-gray-900 truncate">{e.title}</p>
                <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${
                  e.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {e.status}
                </span>
                {!e.content?.take?.trim() && (
                  <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">
                    no take
                  </span>
                )}
                {e.seasons?.length > 0 && (
                  <span className="text-[10px] text-gray-500">{e.seasons.join(' · ')}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 truncate">{e.tagline}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a href={`/app/guide/${e.slug}`} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-gray-500 hover:text-gray-700">View</a>
              <button onClick={() => startEdit(e)} className="text-xs font-bold text-amber-600 hover:text-amber-700">Edit</button>
              <button onClick={() => remove(e)} className="text-xs font-semibold text-red-500 hover:text-red-700">Delete</button>
            </div>
          </div>
        ))}
        {!loading && entries.length === 0 && (
          <p className="text-sm text-gray-500 py-8 text-center">
            No experiences in this city yet. &ldquo;New experience&rdquo; starts the first one.
          </p>
        )}
      </div>
    </div>
  )
}
