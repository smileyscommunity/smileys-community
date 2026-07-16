'use client'

import { toast } from 'sonner'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import ImageUpload from '@/components/ImageUpload'
import { resolveImageUrl, CLUB_CATEGORIES } from '@/lib/data'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { confirmToast } from '@/lib/confirmToast'

const EMOJI_GROUPS = [
  { label: 'Water & Sailing', emojis: ['⛵','🚢','🛥️','⚓','🏄','🤿','🎣','🌊','🐬','🐳','🚤','🛶','🐠','🐟','🦈','🐙','🪸','🏝️','🏖️','🐚','🦀','🦞','🦐','🌅'] },
  { label: 'Outdoor & Nature', emojis: ['🏕️','🏔️','🧗','🌲','🌿','🍃','🦅','🌄','🏞️','🪂','🛺','🚵','🌳','🌴','🌵','🌻','🌷','🌼','☀️','🌤️','⛰️','🦋','🐝','🌾'] },
  { label: 'Sports & Fitness', emojis: ['⚽','🏀','🎾','🏊','🚴','🤸','🏋️','🧘','🏇','⛷️','🥊','🏆','🏐','🏉','🥏','⛳','🎳','🎯','🏓','🥅','🥋','🤺','🏹','🛹'] },
  { label: 'Food & Dining', emojis: ['🍽️','🍷','🍕','🍜','🥘','🍣','🥗','☕','🧁','🍰','🥂','🍻','🍔','🍟','🌮','🌯','🥙','🍱','🥟','🍤','🍩','🍪','🍫','🍦'] },
  { label: 'Arts & Creative', emojis: ['🎨','📸','🎭','🎬','🎶','🎸','🎹','🖌️','✏️','📝','🎤','🎻','🎵','🎷','🥁','🪕','🪘','🎺','🎫','🪩','🖼️','📷','🧩','🎼'] },
  { label: 'Social & Culture', emojis: ['🎉','🌍','🗺️','🏛️','📚','🎓','🤝','💡','🔭','🧪','🎲','♟️','🏰','🗽','🗿','⛩️','🕌','📜','📖','💬','🪙','🛕','🌐','🧭'] },
  { label: 'Wellness & Family', emojis: ['🧘','💆','🌸','🌺','👨‍👩‍👧','👶','❤️','🌈','🕊️','🧠','🪴','🫶','🧖','💇','💅','🛀','💐','🍀','🌿','💊','🌡️','👵','👴','🥰'] },
  { label: 'Night & Exclusive', emojis: ['🌙','✨','🎊','🥳','🍾','💎','👑','🎩','🕺','💃','🌟','🔮','🍸','🥃','🍹','🌃','🌌','🎰','💫','⭐','🌠','🍷','🥂','🎷'] },
  { label: 'Travel & Adventure', emojis: ['✈️','🛫','🛬','🚂','🚄','🚅','🚌','🚗','🏎️','🛵','🚲','🛴','🗺️','🧳','🎒','🏨','🛤️','🚉','🛳️','🚁','🪪','🚇','🚙','🛻'] },
  { label: 'Tech & Gaming', emojis: ['💻','🖥️','⌨️','🖱️','📱','📲','🎮','🕹️','👾','🤖','🛸','💾','💿','📀','🔌','🔋','🛰️','📡','📺','📻','🧮','⏰','⌚','🕰️'] },
  { label: 'Animals & Pets', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐦','🦆','🐢','🦎','🐍','🦜','🦦','🐿️'] },
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
  // List-card signal additions — populated by GET /api/admin/clubs.
  // Both null-safe when API not yet returning them (older clients).
  pendingCount?: number
  quality?: {
    eventsTracked:   number
    totalResponses:  number
    wouldReturnRate: number | null
    anomalyCount:    number
    responseRate:    number | null
  } | null
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
  // Shared admin-load hook replaces the per-page load + error +
  // retry scaffold. Same behavior end-to-end; ~15 fewer lines.
  const { data, loading, error: loadError, retry: loadClubs, setData } = useAdminLoad<Club[]>(
    '/app/api/admin/clubs',
    (v): v is Club[] => Array.isArray(v),
  )
  const clubList = data ?? []
  // Local mutations (PATCH / POST / DELETE handlers below) call
  // setData to patch the cached list without re-fetching.
  const setClubList = (next: Club[] | ((prev: Club[]) => Club[])) => {
    setData(typeof next === 'function' ? next(data ?? []) : next)
  }

  const [saving,     setSaving]     = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [seeding,    setSeeding]    = useState(false)
  const [newForm,    setNewForm]    = useState(emptyForm)

  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editForm,   setEditForm]   = useState(emptyForm)
  // Member management used to live here in a modal. Now everything
  // — pending requests, role changes, add/remove — happens on the
  // detail page (/admin/clubs/[id]) which also carries the Quality
  // card. The "Manage" button below routes there.

  // Search + filter — mirrors the pattern from /admin/users,
  // /admin/feedback, /admin/neighborhoods so admin UX stays
  // consistent. URL-sync skipped here for v1 since the page state
  // is bounded enough that landing on it cold doesn't lose much.
  const [search,       setSearch]       = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [statusFilter,   setStatusFilter]   = useState<'all' | 'active' | 'inactive' | 'with-pending'>('all')

  // Two-stage destructive confirms — Delete is permanent (cascades
  // to events), Deactivate is recoverable but notifies members.
  // Both open as a small inline dialog over the card rather than a
  // full modal so admin context stays visible.
  const [deletingClub, setDeletingClub] = useState<Club | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deactivatingClub, setDeactivatingClub] = useState<Club | null>(null)
  const [deactivateReason, setDeactivateReason] = useState('')

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
    if (!res.ok) {
      // Previously a 403 / 500 silently left the admin in inline-
      // edit mode with no feedback. They'd retry, get the same
      // result, and be unable to tell which field the server
      // rejected. Surface the message instead.
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Could not save club')
      return
    }
    const updated = await res.json()
    setClubList(prev => prev.map(c => c.id === id ? { ...c, ...updated } : c))
    setEditingId(null)
    toast.success('Club updated ✓')
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

  // Auto-join members to the regional Culture clubs (Scandinavian, Balkan,
  // Latin American, …) that match their nationality. Previews net-new count
  // first, then writes on confirm. Idempotent — safe to re-run as members join.
  async function handleSeedRegional() {
    setSeeding(true)
    try {
      const preview = await fetch('/app/api/admin/clubs/seed-regional', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      if (!preview.ok) { toast.error('Preview failed'); return }
      const { netNew } = await preview.json()
      if (netNew === 0) { toast.success('All matching members are already in their regional clubs ✓'); return }

      const ok = await confirmToast(
        `Add ${netNew} membership${netNew === 1 ? '' : 's'} across the regional culture clubs, matched by nationality? (Turkey excluded; no notifications sent.)`,
        { confirmLabel: 'Seed clubs' },
      )
      if (!ok) return

      const res = await fetch('/app/api/admin/clubs/seed-regional', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      })
      if (!res.ok) { toast.error('Seeding failed'); return }
      const r = await res.json()
      toast.success(`Seeded ${r.netNew} member${r.netNew === 1 ? '' : 's'} into regional clubs ✓`)
      loadClubs()
    } finally {
      setSeeding(false)
    }
  }

  // Reactivation is one-click (the club's coming back online — no
  // friction needed). Deactivation routes through the inline
  // dialog so admin can leave a reason for members. The body is
  // sent with _deactivateReason which the API treats as a notify
  // side-channel.
  async function toggleActive(club: Club) {
    if (club.isActive) {
      setDeactivatingClub(club)
      setDeactivateReason('')
      return
    }
    const res = await fetch(`/app/api/admin/clubs/${club.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
    if (res.ok) {
      setClubList(prev => prev.map(c => c.id === club.id ? { ...c, isActive: true } : c))
      toast.success(`"${club.name}" reactivated · members notified`)
    } else {
      toast.error('Could not reactivate')
    }
  }

  async function confirmDeactivate() {
    if (!deactivatingClub) return
    const res = await fetch(`/app/api/admin/clubs/${deactivatingClub.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false, _deactivateReason: deactivateReason.trim() }),
    })
    if (res.ok) {
      const id = deactivatingClub.id
      const name = deactivatingClub.name
      setClubList(prev => prev.map(c => c.id === id ? { ...c, isActive: false } : c))
      setDeactivatingClub(null)
      setDeactivateReason('')
      toast.success(`"${name}" deactivated · ${deactivateReason.trim() ? 'reason sent to members' : 'members notified'}`)
    } else {
      toast.error('Could not deactivate')
    }
  }

  // Delete is irreversible (FK cascade nukes events). Require the
  // admin to type the club name to confirm — same pattern GitHub
  // uses for repo deletion. Stops fat-finger accidents cold.
  function openDeleteConfirm(club: Club) {
    setDeletingClub(club)
    setDeleteConfirmText('')
  }
  async function confirmDelete() {
    if (!deletingClub || deleteConfirmText !== deletingClub.name) return
    const res = await fetch(`/app/api/admin/clubs/${deletingClub.id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      const id = deletingClub.id
      const name = deletingClub.name
      setClubList(prev => prev.filter(c => c.id !== id))
      setDeletingClub(null)
      setDeleteConfirmText('')
      toast(`"${name}" deleted`)
    } else {
      toast.error('Could not delete')
    }
  }

  // Aggregate signals for the stats header. Computed from clubList
  // each render — clubList is bounded enough (tens, not thousands)
  // that re-running these is cheaper than memoising.
  const totalClubs   = clubList.length
  const activeCount  = clubList.filter(c => c.isActive).length
  const pendingTotal = clubList.reduce((s, c) => s + (c.pendingCount ?? 0), 0)

  // Filtered list — search hits name + description + slug; category
  // dropdown filters exactly; status pills filter active/inactive/
  // with-pending. All three composable.
  const filtered = clubList.filter(c => {
    if (categoryFilter && c.category !== categoryFilter) return false
    if (statusFilter === 'active'       && !c.isActive)              return false
    if (statusFilter === 'inactive'     &&  c.isActive)              return false
    if (statusFilter === 'with-pending' && (c.pendingCount ?? 0) === 0) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${c.name} ${c.description} ${c.slug}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="p-4 sm:p-6 space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Clubs</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {totalClubs} clubs · {filtered.length === totalClubs ? 'all shown' : `${filtered.length} shown`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSeedRegional}
            disabled={seeding}
            title="Auto-join members to the regional Culture clubs (Scandinavian, Balkan, Latin American, …) matching their nationality. Previews first; idempotent."
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-50"
          >
            {seeding ? 'Seeding…' : '🌍 Seed regional clubs'}
          </button>
          <button onClick={() => { setShowCreate(!showCreate); setEditingId(null) }} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl px-4 py-2 text-sm">
            + Create club
          </button>
        </div>
      </div>

      {/* Stats header — same shape as /admin/feedback, /admin/users
          etc. 2-up on mobile, 3-up sm+. Pending tile is a link-y
          shortcut: click and the list filters to clubs with
          outstanding join requests. */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Total</div>
            <div className="text-2xl font-extrabold text-white">{totalClubs}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Active</div>
            <div className="text-2xl font-extrabold text-emerald-400">{activeCount}</div>
          </div>
          <button onClick={() => setStatusFilter(statusFilter === 'with-pending' ? 'all' : 'with-pending')}
            className={`bg-zinc-900 border rounded-2xl p-4 text-left transition-colors col-span-2 sm:col-span-1 ${
              statusFilter === 'with-pending' ? 'border-amber-500' : 'border-zinc-800 hover:border-zinc-700'
            }`}>
            <div className="text-xs text-zinc-500 mb-1">Pending requests</div>
            <div className={`text-2xl font-extrabold ${pendingTotal > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>{pendingTotal}</div>
            {pendingTotal > 0 && <div className="text-[10px] text-zinc-600 mt-1">Tap to filter</div>}
          </button>
        </div>
      )}

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

      {/* Search + filter bar */}
      {!loading && totalClubs > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search clubs by name, slug, or description…"
              className="w-full pl-10 pr-3 py-2 text-sm rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">All categories</option>
            {CLUB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 border border-zinc-700">
            {(['all', 'active', 'inactive', 'with-pending'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  statusFilter === s ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
                }`}>
                {s === 'with-pending' ? 'Pending' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      <LoadErrorBanner message={loadError} onRetry={loadClubs} title="Couldn't load clubs" />

      {/* Page-shape skeleton — mirrors the actual card grid so the
          jump-from-Loading-text-to-cards transition is a fill-in
          rather than a layout shift. */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-800 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-1/3 rounded bg-zinc-800/60 animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-zinc-800/60 animate-pulse" />
                </div>
              </div>
              <div className="pt-3 border-t border-zinc-800 grid grid-cols-3 gap-1.5">
                {[0, 1, 2].map(j => <div key={j} className="h-8 rounded-lg bg-zinc-800 animate-pulse" />)}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && totalClubs === 0 && (
        <div className="text-center py-16 bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl">
          <p className="text-3xl mb-3">🪴</p>
          <p className="text-white font-semibold mb-1">No clubs yet</p>
          <p className="text-sm text-zinc-500 mb-5">Clubs group events, hosts, and members around a shared interest.</p>
          <button onClick={() => setShowCreate(true)} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl px-4 py-2 text-sm">
            + Create your first club
          </button>
        </div>
      )}
      {!loading && totalClubs > 0 && filtered.length === 0 && (
        <div className="text-center text-zinc-500 py-12 text-sm">No clubs match your filters.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((club) => (
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
                      ? <img src={resolveImageUrl(club.coverImage)} alt={club.name}
                          className="w-full h-full object-cover"
                          style={{ objectPosition: `center ${club.coverImagePosition ?? 50}%` }} />
                      : club.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold ${club.isActive ? 'text-white' : 'text-zinc-500'}`}>{club.name}</h3>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{club.category}</span>
                      {club.isPrivate && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">Private</span>}
                      {!club.isActive && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Inactive</span>}
                      {/* Pending badge — the difference between
                          "missed 5 join requests for a week" and
                          "I saw that, I'll triage it now." */}
                      {(club.pendingCount ?? 0) > 0 && (
                        <Link href={`/admin/clubs/${club.id}`}
                          className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                          title="Pending join requests · tap to review">
                          {club.pendingCount} pending
                        </Link>
                      )}
                    </div>
                    {/* Slug under name — the URL identity admins
                        need when sharing or linking. text-[10px]
                        keeps it out of the way. */}
                    <p className="text-[10px] text-zinc-600 mt-0.5 font-mono">/{club.slug}</p>
                    <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed line-clamp-2">{club.description}</p>
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
                      {/* Quality pill — at-a-glance health check.
                          Surfaces only when there's enough signal
                          (≥1 survey response). Green ≥80%, amber
                          60–79%, red <60% wouldReturn. Tracks
                          /admin/feedback colour bands. */}
                      {club.quality && club.quality.totalResponses > 0 && club.quality.wouldReturnRate !== null && (
                        <Link href={`/admin/clubs/${club.id}`}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                            club.quality.wouldReturnRate >= 80 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                              : club.quality.wouldReturnRate >= 60 ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                          }`}
                          title={`${club.quality.wouldReturnRate}% would attend again · ${club.quality.totalResponses} response${club.quality.totalResponses === 1 ? '' : 's'}${club.quality.responseRate !== null ? ` (${club.quality.responseRate}% response rate)` : ''}`}>
                          {club.quality.wouldReturnRate}%
                        </Link>
                      )}
                    </div>
                    <button onClick={() => openDeleteConfirm(club)} className="text-xs text-red-400 hover:text-red-300 transition-colors font-medium px-2 py-1">
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

      {/* Deactivate confirm — captures an optional reason to send
          to members. Keeps members in the loop when a club is being
          wound down rather than letting it silently go quiet. */}
      {deactivatingClub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setDeactivatingClub(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-bold text-base mb-1">Deactivate &ldquo;{deactivatingClub.name}&rdquo;?</h2>
            <p className="text-sm text-zinc-500 mb-4">
              Members keep their membership but new events stop. They&apos;ll get a notification — add a reason if you want them to know why.
            </p>
            <textarea value={deactivateReason} onChange={e => setDeactivateReason(e.target.value)}
              placeholder="Optional · e.g. Host is on sabbatical until October"
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeactivatingClub(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={confirmDeactivate}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm — type-the-name pattern. Stops fat-finger
          accidents on a destructive op that also cascades FK
          deletes to events. Activate/Deactivate is the safe path
          for "I want this hidden for a bit". */}
      {deletingClub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setDeletingClub(null)}>
          <div className="bg-zinc-900 border border-red-500/30 rounded-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl shrink-0">⚠️</span>
              <div>
                <h2 className="text-white font-bold text-base">Delete &ldquo;{deletingClub.name}&rdquo;?</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  This deletes the club <strong>and every event under it</strong>. Memberships and posts go with it. You can&apos;t undo this.
                </p>
                <p className="text-sm text-zinc-400 mt-2">
                  If you just want to hide it, use <strong>Deactivate</strong> instead.
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-1.5">Type <code className="text-amber-400 font-mono">{deletingClub.name}</code> to confirm:</p>
            <input type="text" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500 mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeletingClub(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleteConfirmText !== deletingClub.name}
                className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
