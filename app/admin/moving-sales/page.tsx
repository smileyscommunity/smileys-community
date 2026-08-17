'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { useCityNeighborhoods } from '@/hooks/useCityNeighborhoods'
import { downscaleImage } from '@/lib/image-resize'

interface Item { id: string; name: string; price: string | null; claimed: boolean }
interface Sale {
  id: string
  leavingOn: string
  neighborhood: string | null
  note: string | null
  photo: string | null
  status: string
  createdAt: string
  user: { id: string; name: string; email: string; color: string }
  items: Item[]
}

// id is present for existing items (preserves `claimed` server-side and
// lets the PATCH route diff which items were removed); absent for new ones
// added in the edit form.
interface EditItem { id?: string; name: string; price: string }
interface EditForm {
  leavingOn: string
  neighborhood: string
  note: string
  photo: string
  items: EditItem[]
}

const STATUS_COLOR: Record<string, string> = {
  active:  'bg-green-500/10 text-green-400',
  done:    'bg-zinc-700/40 text-zinc-400',
  removed: 'bg-red-500/10 text-red-400',
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: color }}>
      {name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function AdminMovingSalesPage() {
  const neighborhoods = useCityNeighborhoods()
  const [sales,   setSales]   = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [status,  setStatus]  = useState<'all' | 'active' | 'done' | 'removed'>('active')
  const [removingId, setRemovingId] = useState<string | null>(null)

  const [editing,  setEditing]  = useState<Sale | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ leavingOn: '', neighborhood: '', note: '', photo: '', items: [] })
  const [saving,    setSaving]    = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/app/api/admin/moving-sales', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data?.error || `Couldn't load (HTTP ${res.status})`); return }
      setSales(data.sales ?? [])
    } catch {
      setError('Network error — could not load moving sales')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(id: string) {
    if (!(await confirmToast('Remove this moving sale?'))) return
    setRemovingId(id)
    try {
      const res = await fetch(`/app/api/moving-sales/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'removed' }),
      })
      if (!res.ok) { toast.error('Could not remove'); return }
      setSales(prev => prev.map(s => s.id === id ? { ...s, status: 'removed' } : s))
      toast.success('Removed')
    } catch {
      toast.error('Network error')
    } finally {
      setRemovingId(null)
    }
  }

  function openEdit(sale: Sale) {
    setEditing(sale)
    setEditForm({
      leavingOn:    sale.leavingOn.slice(0, 10),
      neighborhood: sale.neighborhood ?? '',
      note:         sale.note ?? '',
      photo:        sale.photo ?? '',
      items:        sale.items.map(it => ({ id: it.id, name: it.name, price: it.price ?? '' })),
    })
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const upload = await downscaleImage(file)
      const form = new FormData()
      form.append('file', upload)
      const res  = await fetch('/app/api/upload', { method: 'POST', body: form, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (data.url) setEditForm(f => ({ ...f, photo: data.url }))
      else toast.error('Could not upload photo')
    } finally { setUploading(false) }
  }

  async function saveEdit() {
    if (!editing || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/app/api/moving-sales/${editing.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leavingOn:    editForm.leavingOn,
          neighborhood: editForm.neighborhood || null,
          note:         editForm.note || null,
          photo:        editForm.photo || null,
          items:        editForm.items.filter(it => it.name.trim()),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not save'); return }
      toast.success('Saved')
      setEditing(null)
      load()
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const visible = sales.filter(s => status === 'all' || s.status === status)

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Moving Sales</h1>
        <p className="text-zinc-400 text-sm mt-1">{visible.length} sale{visible.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['active', 'done', 'removed', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${
              status === s
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-zinc-900 border border-zinc-800 rounded-2xl animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="text-center py-16 text-zinc-500">
          <p className="mb-3">{error}</p>
          <button onClick={load} className="text-amber-400 hover:underline text-sm">Try again</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">No {status !== 'all' ? status : ''} moving sales</div>
      ) : (
        <div className="space-y-3">
          {visible.map(s => (
            <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  {s.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photo} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                  ) : (
                    <Avatar name={s.user.name} color={s.user.color} />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{s.user.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[s.status] ?? STATUS_COLOR.active}`}>
                        {s.status}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{s.user.email}</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Leaving {new Date(s.leavingOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {s.neighborhood && <> · {s.neighborhood}</>}
                    </p>
                    {s.note && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{s.note}</p>}
                    {s.items.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {s.items.map(it => (
                          <span key={it.id}
                            className={`text-xs px-2 py-1 rounded-lg border ${
                              it.claimed ? 'border-zinc-700 text-zinc-500 line-through' : 'border-zinc-700 text-zinc-300'
                            }`}>
                            {it.name}{it.price ? ` — ${it.price}` : ' — Free'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {s.status !== 'removed' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEdit(s)}
                      className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 px-3 py-2 rounded-lg font-medium transition-colors">
                      Edit
                    </button>
                    <button onClick={() => remove(s.id)} disabled={removingId === s.id}
                      className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                      {removingId === s.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white">Edit Moving Sale</h2>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Leaving on</label>
              <input type="date" value={editForm.leavingOn}
                onChange={e => setEditForm(f => ({ ...f, leavingOn: e.target.value }))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Neighborhood</label>
              <select value={editForm.neighborhood}
                onChange={e => setEditForm(f => ({ ...f, neighborhood: e.target.value }))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="">—</option>
                {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Note</label>
              <textarea value={editForm.note} maxLength={500} rows={3}
                onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Photo</label>
              {editForm.photo ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={editForm.photo} alt="" className="w-16 h-16 rounded-lg object-cover" />
                  <button onClick={() => setEditForm(f => ({ ...f, photo: '' }))}
                    className="text-xs text-red-400 hover:underline">Remove photo</button>
                </div>
              ) : (
                <label className="inline-block text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-2 rounded-lg cursor-pointer">
                  {uploading ? 'Uploading…' : 'Upload photo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} disabled={uploading} />
                </label>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Items</label>
              <div className="space-y-2">
                {editForm.items.map((it, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={it.name} placeholder="Item"
                      onChange={e => setEditForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
                    <input value={it.price} placeholder="Price"
                      onChange={e => setEditForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, price: e.target.value } : x) }))}
                      className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
                    <button onClick={() => setEditForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
                      className="text-red-400 hover:text-red-300 px-2">✕</button>
                  </div>
                ))}
                <button onClick={() => setEditForm(f => ({ ...f, items: [...f.items, { name: '', price: '' }] }))}
                  className="text-xs text-amber-400 hover:underline">+ Add item</button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditing(null)} disabled={saving}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving || uploading}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
