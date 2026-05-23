'use client'

import { useState } from 'react'

interface Resource {
  id: string; clubId: string; title: string; url: string; emoji: string; order: number; createdAt: string | Date
}

interface Props {
  slug: string
  initialResources: Resource[]
  canEdit: boolean
  dark?: boolean
}

export default function ClubResources({ slug, initialResources, canEdit, dark }: Props) {
  const [resources, setResources] = useState<Resource[]>(initialResources)
  const [title, setTitle]         = useState('')
  const [url, setUrl]             = useState('')
  const [emoji, setEmoji]         = useState('🔗')
  const [adding, setAdding]       = useState(false)
  const [error, setError]         = useState('')

  async function addResource() {
    if (!title.trim() || !url.trim() || adding) return
    setAdding(true); setError('')
    const res = await fetch(`/app/api/clubs/${slug}/resources`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), url: url.trim(), emoji: emoji.trim() || '🔗' }),
    })
    if (res.ok) {
      const resource = await res.json()
      setResources(prev => [...prev, resource])
      setTitle(''); setUrl(''); setEmoji('🔗')
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to add')
    }
    setAdding(false)
  }

  async function removeResource(id: string) {
    const res = await fetch(`/app/api/clubs/${slug}/resources/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setResources(prev => prev.filter(r => r.id !== id))
  }

  if (!canEdit && resources.length === 0) return null

  const card    = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-6' : 'bg-white shadow-card rounded-2xl p-6'
  const title_  = dark ? 'text-white' : 'text-gray-900'
  const muted   = dark ? 'text-zinc-500' : 'text-gray-500'
  const divider = dark ? 'border-zinc-800' : 'border-gray-100'
  const del_    = dark ? 'text-zinc-600 hover:text-red-400' : 'text-gray-300 hover:text-red-400'
  const input   = dark
    ? 'bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400'
    : 'border border-gray-200 text-gray-800 placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400'

  return (
    <div className={card}>
      <h3 className={`font-bold ${title_} mb-4`}>Resources</h3>
      {resources.length > 0 && (
        <ul className="space-y-2 mb-4">
          {resources.map(r => (
            <li key={r.id} className="flex items-center gap-2">
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700 hover:underline flex-1 min-w-0">
                <span className="text-base shrink-0">{r.emoji}</span>
                <span className="truncate">{r.title}</span>
              </a>
              {canEdit && (
                <button onClick={() => removeResource(r.id)}
                  className={`${del_} text-lg leading-none shrink-0 transition-colors`}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className={`border-t ${divider} pt-4 space-y-2`}>
          <p className={`text-xs font-semibold ${muted} mb-2`}>Add resource</p>
          <div className="flex gap-2">
            <input type="text" value={emoji} onChange={e => setEmoji(e.target.value)}
              placeholder="🔗" maxLength={4}
              className={`w-12 text-center text-sm px-2 py-2 ${input}`} />
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Title" maxLength={100}
              className={`flex-1 text-sm px-3 py-2 ${input}`} />
          </div>
          <div className="flex gap-2">
            <input type="url" value={url} onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addResource() }}
              placeholder="https://…"
              className={`flex-1 text-sm px-3 py-2 ${input}`} />
            <button onClick={addResource} disabled={!title.trim() || !url.trim() || adding}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 shrink-0">
              {adding ? '…' : 'Add'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  )
}
