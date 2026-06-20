'use client'

import { useState } from 'react'
import { resolveImageUrl, getInitials } from '@/lib/data'

interface SpotlightUser {
  userId: string; name: string; color: string; photo: string | null
  bio: string | null; note: string | null; updatedAt: string | Date | null
}
interface ClubMember { id: string; name: string; color: string; photo: string | null }

interface Props {
  slug: string
  initialSpotlight: SpotlightUser | null
  canEdit: boolean
  dark?: boolean
}

export default function ClubSpotlight({ slug, initialSpotlight, canEdit, dark }: Props) {
  const [spotlight, setSpotlight]   = useState<SpotlightUser | null>(initialSpotlight)
  const [editing, setEditing]       = useState(false)
  const [members, setMembers]       = useState<ClubMember[]>([])
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState<ClubMember | null>(null)
  const [noteInput, setNoteInput]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [loadingMembers, setLoadingMembers] = useState(false)

  if (!spotlight && !canEdit) return null

  function openEdit() {
    setEditing(true); setError(''); setSelected(null); setSearch(''); setNoteInput('')
    if (members.length === 0) {
      setLoadingMembers(true)
      fetch(`/app/api/clubs/${slug}/members`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          if (Array.isArray(data)) {
            setMembers(data.map((m: any) => ({
              id:    m.id,
              name:  m.fullName ?? m.firstName ?? 'Unknown',
              color: m.color,
              photo: m.photo,
            })))
          }
        })
        .finally(() => setLoadingMembers(false))
    }
  }

  async function save() {
    if (!selected || saving) return
    setSaving(true); setError('')
    const res = await fetch(`/app/api/clubs/${slug}/spotlight`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selected.id, note: noteInput.trim() || null }),
    })
    if (res.ok) { setSpotlight(await res.json()); setEditing(false) }
    else { const d = await res.json(); setError(d.error ?? 'Failed to update') }
    setSaving(false)
  }

  const filtered = search.trim()
    ? members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
    : members

  const photo = resolveImageUrl(spotlight?.photo)

  const card    = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-6' : 'bg-white shadow-card rounded-2xl p-6'
  const title   = dark ? 'text-white' : 'text-gray-900'
  const name_   = dark ? 'text-white' : 'text-gray-900'
  const bio_    = dark ? 'text-zinc-500' : 'text-gray-400'
  const note_   = dark ? 'text-zinc-400' : 'text-gray-600'
  const muted   = dark ? 'text-zinc-500' : 'text-gray-400'
  const label   = dark ? 'text-zinc-500' : 'text-gray-600'
  const selBg   = dark ? 'bg-zinc-800 border border-amber-500/30' : 'bg-amber-50 border border-amber-200'
  const selName = dark ? 'text-white' : 'text-gray-900'
  const listBg  = dark ? 'border border-zinc-700 divide-y divide-zinc-800' : 'border border-gray-200 divide-y divide-gray-100'
  const listHov = dark ? 'hover:bg-zinc-800' : 'hover:bg-gray-50'
  const listTxt = dark ? 'text-zinc-200' : 'text-gray-800'
  const input   = dark
    ? 'bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400'
    : 'border border-gray-200 text-gray-800 placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400'

  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-bold ${title}`}>Member spotlight</h3>
        {canEdit && (
          <button onClick={() => editing ? setEditing(false) : openEdit()}
            className="text-xs text-amber-600 hover:text-amber-700 font-semibold transition-colors">
            {editing ? 'Cancel' : spotlight ? 'Change' : 'Set'}
          </button>
        )}
      </div>

      {spotlight && !editing && (
        <div className="flex items-start gap-3">
          {photo ? (
            <img src={photo} alt={spotlight.name} loading="lazy" className="w-12 h-12 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
              style={{ backgroundColor: spotlight.color }}>
              {getInitials(spotlight.name)}
            </div>
          )}
          <div className="min-w-0">
            <p className={`font-semibold text-sm ${name_}`}>{spotlight.name}</p>
            {spotlight.bio && <p className={`text-xs ${bio_} mt-0.5 line-clamp-2`}>{spotlight.bio}</p>}
            {spotlight.note && <p className={`text-sm ${note_} mt-2 italic`}>&ldquo;{spotlight.note}&rdquo;</p>}
          </div>
        </div>
      )}

      {!spotlight && !editing && canEdit && (
        <p className={`text-sm ${muted}`}>No member spotlighted yet. Click Set to choose someone.</p>
      )}

      {editing && (
        <div className="space-y-4">
          {selected ? (
            <div className={`flex items-center gap-3 p-3 ${selBg} rounded-xl`}>
              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: selected.color }}>
                {selected.photo
                  ? <img src={resolveImageUrl(selected.photo)} alt={selected.name} className="w-full h-full object-cover" />
                  : getInitials(selected.name)}
              </div>
              <span className={`text-sm font-semibold ${selName} flex-1`}>{selected.name}</span>
              <button onClick={() => { setSelected(null); setSearch('') }}
                className={`${muted} hover:text-red-400 text-lg leading-none transition-colors`}>×</button>
            </div>
          ) : (
            <div>
              <label className={`text-xs font-semibold ${label} block mb-1.5`}>Pick a member</label>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search club members…"
                className={`w-full text-sm px-3 py-2 ${input}`} />
              {loadingMembers ? (
                <p className={`text-xs ${muted} mt-2`}>Loading members…</p>
              ) : (
                <div className={`mt-1 max-h-48 overflow-y-auto rounded-xl ${listBg}`}>
                  {filtered.length === 0 ? (
                    <p className={`text-xs ${muted} px-3 py-2`}>{search ? 'No match' : 'No members'}</p>
                  ) : filtered.map(m => (
                    <button key={m.id} onClick={() => { setSelected(m); setSearch('') }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 ${listHov} transition-colors text-left`}>
                      <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                        style={{ backgroundColor: m.color }}>
                        {m.photo
                          ? <img src={resolveImageUrl(m.photo)} alt={m.name} className="w-full h-full object-cover" />
                          : getInitials(m.name)}
                      </div>
                      <span className={`text-sm ${listTxt}`}>{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div>
            <label className={`text-xs font-semibold ${label} block mb-1.5`}>Host note (optional)</label>
            <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)}
              placeholder="Why are you spotlighting this member?"
              rows={2} maxLength={500}
              className={`w-full text-sm px-3 py-2 ${input} resize-none`} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button onClick={save} disabled={!selected || saving}
            className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : 'Save spotlight'}
          </button>
        </div>
      )}
    </div>
  )
}
