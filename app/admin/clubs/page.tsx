'use client'

import { toast } from 'sonner'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import ImageUpload from '@/components/ImageUpload'
import { resolveImageUrl, CLUB_CATEGORIES } from '@/lib/data'

const EMOJI_GROUPS = [
  { label: 'Water & Sailing', emojis: ['⛵','🚢','🛥️','⚓','🏄','🤿','🎣','🌊','🐬','🐳','🚤','🛶'] },
  { label: 'Outdoor & Nature', emojis: ['🏕️','🏔️','🧗','🌲','🌿','🍃','🦅','🌄','🏞️','🪂','🛺','🚵'] },
  { label: 'Sports & Fitness', emojis: ['⚽','🏀','🎾','🏊','🚴','🤸','🏋️','🧘','🏇','⛷️','🥊','🏆'] },
  { label: 'Food & Dining', emojis: ['🍽️','🍷','🍕','🍜','🥘','🍣','🥗','☕','🧁','🍰','🥂','🍻'] },
  { label: 'Arts & Creative', emojis: ['🎨','📸','🎭','🎬','🎶','🎸','🎹','🖌️','✏️','📝','🎤','🎻'] },
  { label: 'Social & Culture', emojis: ['🎉','🌍','🗺️','🏛️','📚','🎓','🤝','💡','🔭','🧪','🎲','♟️'] },
  { label: 'Wellness & Family', emojis: ['🧘','💆','🌸','🌺','👨‍👩‍👧','👶','❤️','🌈','🕊️','🧠','🪴','🫶'] },
  { label: 'Night & Exclusive', emojis: ['🌙','✨','🎊','🥳','🍾','💎','👑','🎩','🕺','💃','🌟','🔮'] },
]

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Emoji</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-14 h-10 text-2xl rounded-xl border border-zinc-700 hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 flex items-center justify-center transition-colors bg-zinc-800"
      >
        {value || '🎉'}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-2xl p-3 w-64 sm:w-72 max-h-72 overflow-y-auto">
          {EMOJI_GROUPS.map(group => (
            <div key={group.label} className="mb-3">
              <div className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1.5 px-1">{group.label}</div>
              <div className="grid grid-cols-6 gap-1">
                {group.emojis.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => { onChange(emoji); setOpen(false) }}
                    className={`text-xl h-9 w-full rounded-lg hover:bg-amber-500/10 flex items-center justify-center transition-colors ${value === emoji ? 'bg-amber-500/10 ring-1 ring-amber-500' : ''}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Club {
  id:          string
  name:        string
  slug:        string
  description: string
  category:    string
  emoji:       string
  color:       string
  bgColor:     string
  memberCount: number
  _count?: { events: number }
  whatsappUrl:  string | null
  instagramUrl: string | null
  rules:        string | null
  isPrivate:    boolean
  isActive:     boolean
  coverImage:         string | null
  coverImagePosition: number
  location:           string | null
  foundedAt:          string | null
  createdAt:          string | null
}

const emptyForm = {
  name: '', description: '', category: '', emoji: '🎉',
  whatsappUrl: '', instagramUrl: '', rules: '',
  isPrivate: false, coverImage: '', coverImagePosition: 50, location: '', foundedAt: '',
}

const inputCls = 'bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none px-3 py-2.5 w-full text-sm'

function ClubForm({
  value,
  onChange,
}: {
  value: typeof emptyForm
  onChange: (v: typeof emptyForm) => void
}) {
  function set(key: string, val: string | boolean | number) {
    onChange({ ...value, [key]: val })
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Club name *</label>
        <input type="text" value={value.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Istanbul Photography Club" className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Category *</label>
        <select value={value.category} onChange={e => set('category', e.target.value)} required className={inputCls}>
          <option value="">Select a category…</option>
          {CLUB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description *</label>
        <textarea rows={2} value={value.description} onChange={e => set('description', e.target.value)} placeholder="What's this club about?" className={`${inputCls} resize-none`} />
      </div>
      <div>
        <EmojiPicker value={value.emoji} onChange={emoji => set('emoji', emoji)} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Location</label>
        <input type="text" value={value.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Karaköy, Istanbul" className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp URL</label>
        <input type="text" value={value.whatsappUrl} onChange={e => set('whatsappUrl', e.target.value)} placeholder="https://chat.whatsapp.com/..." className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Instagram URL</label>
        <input type="text" value={value.instagramUrl} onChange={e => set('instagramUrl', e.target.value)} placeholder="https://instagram.com/..." className={inputCls} />
      </div>
      <div>
        <ImageUpload value={value.coverImage ?? ''} onChange={url => set('coverImage', url)} folder="clubs" label="Cover image"
          position={value.coverImagePosition ?? 50} onPositionChange={pos => set('coverImagePosition', pos)} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Founded date</label>
        <input type="date" value={value.foundedAt} onChange={e => set('foundedAt', e.target.value)} className={`${inputCls} admin-date-input`} />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Rules / Guidelines</label>
        <textarea rows={3} value={value.rules} onChange={e => set('rules', e.target.value)} placeholder="Club rules and guidelines…" className={`${inputCls} resize-none`} />
      </div>
      <div className="col-span-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={value.isPrivate} onChange={e => set('isPrivate', e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
          <span className="text-sm text-zinc-300">Private club (invite only)</span>
        </label>
      </div>
    </div>
  )
}

export default function AdminClubsPage() {
  const [clubList,   setClubList]   = useState<Club[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [newForm,    setNewForm]    = useState(emptyForm)

  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editForm,   setEditForm]   = useState(emptyForm)
  // Member management used to live here in a modal. Now everything
  // — pending requests, role changes, add/remove — happens on the
  // detail page (/admin/clubs/[id]) which also carries the Quality
  // card. The "Manage" button below routes there.

  useEffect(() => {
    fetch('/app/api/admin/clubs', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setClubList(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])


  function startEdit(club: Club) {
    setEditingId(club.id)
    setEditForm({
      name:         club.name,
      description:  club.description,
      category:     club.category,
      emoji:        club.emoji,
      whatsappUrl:  club.whatsappUrl  ?? '',
      instagramUrl: club.instagramUrl ?? '',
      rules:        club.rules        ?? '',
      isPrivate:    club.isPrivate,
      coverImage:         club.coverImage         ?? '',
      coverImagePosition: club.coverImagePosition ?? 50,
      location:           club.location           ?? '',
      foundedAt:    club.foundedAt    ? club.foundedAt.split('T')[0] : '',
    })
  }

  async function saveEdit(id: string) {
    setSaving(true)
    const res = await fetch(`/app/api/admin/clubs/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...editForm,
        whatsappUrl:  editForm.whatsappUrl  || null,
        instagramUrl: editForm.instagramUrl || null,
        rules:        editForm.rules        || null,
        coverImage:         editForm.coverImage   || null,
        coverImagePosition: editForm.coverImagePosition,
        location:           editForm.location     || null,
        foundedAt:    editForm.foundedAt    ? new Date(editForm.foundedAt).toISOString() : null,
      }),
    })
    setSaving(false)
    if (res.ok) {
      const updated = await res.json()
      setClubList(prev => prev.map(c => c.id === id ? { ...c, ...updated } : c))
      setEditingId(null)
      toast.success('Club updated ✓')
    }
  }

  async function handleCreate() {
    if (!newForm.name.trim())     { toast.error('Name is required');     return }
    if (!newForm.category.trim()) { toast.error('Category is required'); return }
    setSaving(true)
    const res = await fetch('/app/api/admin/clubs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newForm,
        whatsappUrl:  newForm.whatsappUrl  || null,
        instagramUrl: newForm.instagramUrl || null,
        rules:        newForm.rules        || null,
        coverImage:         newForm.coverImage   || null,
        coverImagePosition: newForm.coverImagePosition,
        location:           newForm.location     || null,
        foundedAt:    newForm.foundedAt    ? new Date(newForm.foundedAt).toISOString() : null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setClubList(prev => [...prev, data])
      setNewForm(emptyForm)
      setShowCreate(false)
      toast.success(`"${data.name}" created ✓`)
    } else {
      toast.error(data?.error ?? 'Could not create club')
    }
  }

  async function handleRecount(clubId: string) {
    const res = await fetch(`/app/api/admin/clubs/${clubId}/recount`, {
      method: 'POST', credentials: 'include',
    })
    if (!res.ok) { toast.error('Recount failed'); return }
    const { memberCount, drift } = await res.json()
    setClubList(prev => prev.map(c => c.id === clubId ? { ...c, memberCount } : c))
    if (drift === 0) {
      toast.success(`Count is already correct (${memberCount})`)
    } else {
      toast.success(`Corrected by ${drift > 0 ? '+' : ''}${drift} → ${memberCount}`)
    }
  }

  async function toggleActive(club: Club) {
    const res = await fetch(`/app/api/admin/clubs/${club.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !club.isActive }),
    })
    if (res.ok) {
      setClubList(prev => prev.map(c => c.id === club.id ? { ...c, isActive: !club.isActive } : c))
      toast.success(`"${club.name}" ${!club.isActive ? 'activated' : 'deactivated'} ✓`)
    }
  }

  async function deleteClub(club: Club) {
    const res = await fetch(`/app/api/admin/clubs/${club.id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setClubList(prev => prev.filter(c => c.id !== club.id))
      toast(`"${club.name}" deleted`)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Clubs</h1>
          <p className="text-sm text-zinc-500 mt-1">{clubList.length} clubs</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setEditingId(null) }} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl px-4 py-2 text-sm">
          + Create club
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-white font-bold mb-5">New club</h2>
          <ClubForm value={newForm} onChange={setNewForm} />
          <div className="flex gap-3 mt-5">
            <button onClick={handleCreate} disabled={saving || !newForm.name.trim()} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-50">
              {saving ? 'Creating…' : 'Create club'}
            </button>
            <button onClick={() => setShowCreate(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-center text-zinc-500 py-12 text-sm">Loading…</div>}
      {!loading && clubList.length === 0 && <div className="text-center text-zinc-500 py-12 text-sm">No clubs yet.</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clubList.map((club) => (
          <div key={club.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
            {editingId === club.id ? (
              <>
                <h3 className="text-white font-bold mb-4">Edit — {club.name}</h3>
                <ClubForm value={editForm} onChange={setEditForm} />
                <div className="flex gap-2 mt-4">
                  <button onClick={() => saveEdit(club.id)} disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl text-xs py-2 px-4 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingId(null)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl text-xs py-2 px-4">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-xl overflow-hidden shrink-0 ${!club.coverImage ? club.bgColor : ''} flex items-center justify-center text-2xl`}>
                    {club.coverImage
                      ? <img src={resolveImageUrl(club.coverImage)} alt={club.name} className="w-full h-full object-cover" />
                      : club.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold ${club.isActive ? 'text-white' : 'text-zinc-500'}`}>{club.name}</h3>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{club.category}</span>
                      {club.isPrivate && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">Private</span>}
                      {!club.isActive && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Inactive</span>}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed line-clamp-2">{club.description}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-zinc-500">
                      {club.location     && <span>📍 {club.location}</span>}
                      {club.whatsappUrl  && <span>💬 WhatsApp</span>}
                      {club.instagramUrl && <span>📸 Instagram</span>}
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500 flex items-center gap-1">
                        👥 {club.memberCount} members
                        {/* Recount — recovery hatch for any drift left
                            over from before B1/B3 were fixed. Quiet
                            icon button next to the count so it
                            doesn't shout for attention. */}
                        <button onClick={() => handleRecount(club.id)}
                          className="text-zinc-700 hover:text-amber-400 transition-colors p-0.5"
                          title="Recount approved memberships">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      </span>
                      {club._count != null && <span className="text-xs text-zinc-500">🗓 {club._count.events} events</span>}
                    </div>
                    <button onClick={() => deleteClub(club)} className="text-xs text-red-400 hover:text-red-300 transition-colors font-medium px-2 py-1">
                      Delete
                    </button>
                  </div>
                  {/* Button row — collapsed from five to three:
                      • Manage: pending requests, members, hosts,
                        Quality card. The single admin surface for
                        a club's people + signal.
                      • Edit: inline form to update copy/cover.
                      • Activate/Deactivate: visibility toggle.
                      The old "Members" modal and the host-UI
                      "Manage" link are gone — both folded into
                      /admin/clubs/[id]. */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <Link href={`/admin/clubs/${club.id}`}
                      className="text-xs px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors font-medium text-center">
                      Manage
                    </Link>
                    <button onClick={() => startEdit(club)}
                      className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors font-medium">
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(club)}
                      className={`text-xs px-3 py-2 rounded-lg font-medium transition-colors ${
                        club.isActive
                          ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                          : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      }`}
                    >
                      {club.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}
