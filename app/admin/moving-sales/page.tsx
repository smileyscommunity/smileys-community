'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

interface Item { id: string; name: string; price: string | null; claimed: boolean }
interface Sale {
  id: string
  leavingOn: string
  neighborhood: string | null
  note: string | null
  status: string
  createdAt: string
  user: { id: string; name: string; email: string; color: string }
  items: Item[]
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
  const [sales,   setSales]   = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [status,  setStatus]  = useState<'all' | 'active' | 'done' | 'removed'>('active')
  const [removingId, setRemovingId] = useState<string | null>(null)

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
                  <Avatar name={s.user.name} color={s.user.color} />
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
                  <button onClick={() => remove(s.id)} disabled={removingId === s.id}
                    className="shrink-0 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                    {removingId === s.id ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
