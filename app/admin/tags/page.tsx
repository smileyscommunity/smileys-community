'use client'

import { useState, useEffect } from 'react'

interface Tag      { id: string; name: string; emoji: string; groupId: string }
interface TagGroup { id: string; name: string; emoji: string; sortOrder: number; tags: Tag[] }

const inputCls = 'px-3 py-2 text-sm border border-zinc-700 rounded-xl bg-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

export default function TagsPage() {
  const [groups,  setGroups]  = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)

  // New group form
  const [newGroupName,  setNewGroupName]  = useState('')
  const [newGroupEmoji, setNewGroupEmoji] = useState('')
  const [savingGroup,   setSavingGroup]   = useState(false)

  // New tag form (per group)
  const [newTagName,  setNewTagName]  = useState<Record<string, string>>({})
  const [newTagEmoji, setNewTagEmoji] = useState<Record<string, string>>({})
  const [savingTag,   setSavingTag]   = useState<Record<string, boolean>>({})

  // Edit state
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [editGroupVal, setEditGroupVal] = useState({ name: '', emoji: '' })
  const [editingTag,   setEditingTag]   = useState<string | null>(null)
  const [editTagVal,   setEditTagVal]   = useState({ name: '', emoji: '' })

  useEffect(() => {
    fetch('/app/api/admin/tag-groups', { credentials: 'include' })
      .then(r => r.json()).then(setGroups).finally(() => setLoading(false))
  }, [])

  async function addGroup() {
    if (!newGroupName.trim()) return
    setSavingGroup(true)
    const res = await fetch('/app/api/admin/tag-groups', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName.trim(), emoji: newGroupEmoji || '🏷️' }),
    })
    if (res.ok) {
      const g = await res.json()
      setGroups(prev => [...prev, { ...g, tags: [] }])
      setNewGroupName(''); setNewGroupEmoji('')
    }
    setSavingGroup(false)
  }

  async function saveGroup(id: string) {
    const res = await fetch(`/app/api/admin/tag-groups/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editGroupVal),
    })
    if (res.ok) {
      setGroups(prev => prev.map(g => g.id === id ? { ...g, ...editGroupVal } : g))
      setEditingGroup(null)
    }
  }

  async function deleteGroup(id: string) {
    if (!confirm('Delete this group and all its tags?')) return
    await fetch(`/app/api/admin/tag-groups/${id}`, { method: 'DELETE', credentials: 'include' })
    setGroups(prev => prev.filter(g => g.id !== id))
  }

  async function addTag(groupId: string) {
    const name = newTagName[groupId]?.trim()
    if (!name) return
    setSavingTag(prev => ({ ...prev, [groupId]: true }))
    const res = await fetch('/app/api/admin/tags', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, emoji: newTagEmoji[groupId] || '🏷️', groupId }),
    })
    if (res.ok) {
      const tag = await res.json()
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, tags: [...g.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) } : g))
      setNewTagName(prev => ({ ...prev, [groupId]: '' }))
      setNewTagEmoji(prev => ({ ...prev, [groupId]: '' }))
    }
    setSavingTag(prev => ({ ...prev, [groupId]: false }))
  }

  async function saveTag(id: string, groupId: string) {
    const res = await fetch(`/app/api/admin/tags/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editTagVal),
    })
    if (res.ok) {
      setGroups(prev => prev.map(g => g.id === groupId
        ? { ...g, tags: g.tags.map(t => t.id === id ? { ...t, ...editTagVal } : t) } : g))
      setEditingTag(null)
    }
  }

  async function deleteTag(id: string, groupId: string) {
    if (!confirm('Delete this tag?')) return
    await fetch(`/app/api/admin/tags/${id}`, { method: 'DELETE', credentials: 'include' })
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, tags: g.tags.filter(t => t.id !== id) } : g))
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Tag Management</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Organise event tags into groups for better discoverability</p>
      </div>

      {/* Add group */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-sm font-bold text-white mb-4">New tag group</h2>
        <div className="flex gap-2 flex-wrap">
          <input value={newGroupEmoji} onChange={e => setNewGroupEmoji(e.target.value)}
            placeholder="🏷️" className={`${inputCls} w-16 text-center`} maxLength={2} />
          <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
            placeholder="Group name (e.g. Venue type)" className={`${inputCls} flex-1 min-w-40`}
            onKeyDown={e => e.key === 'Enter' && addGroup()} />
          <button onClick={addGroup} disabled={savingGroup || !newGroupName.trim()}
            className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors disabled:opacity-50">
            {savingGroup ? '…' : 'Add group'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
          <div className="text-3xl mb-2">🏷️</div>
          <div className="text-zinc-400 text-sm">No tag groups yet. Create one above.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <div key={group.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              {/* Group header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-800/40">
                {editingGroup === group.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input value={editGroupVal.emoji} onChange={e => setEditGroupVal(p => ({ ...p, emoji: e.target.value }))}
                      className={`${inputCls} w-14 text-center`} maxLength={2} />
                    <input value={editGroupVal.name} onChange={e => setEditGroupVal(p => ({ ...p, name: e.target.value }))}
                      className={`${inputCls} flex-1`}
                      onKeyDown={e => e.key === 'Enter' && saveGroup(group.id)} />
                    <button onClick={() => saveGroup(group.id)}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors">
                      Save
                    </button>
                    <button onClick={() => setEditingGroup(null)}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-700 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-xl">{group.emoji}</span>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-white">{group.name}</div>
                      <div className="text-xs text-zinc-500">{group.tags.length} tag{group.tags.length !== 1 ? 's' : ''}</div>
                    </div>
                    <button onClick={() => { setEditingGroup(group.id); setEditGroupVal({ name: group.name, emoji: group.emoji }) }}
                      className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-700 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => deleteGroup(group.id)}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors">
                      Delete
                    </button>
                  </>
                )}
              </div>

              {/* Tags */}
              <div className="p-5">
                <div className="flex flex-wrap gap-2 mb-4">
                  {group.tags.map(tag => (
                    <div key={tag.id} className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5">
                      {editingTag === tag.id ? (
                        <>
                          <input value={editTagVal.emoji} onChange={e => setEditTagVal(p => ({ ...p, emoji: e.target.value }))}
                            className="w-8 bg-transparent text-center text-sm focus:outline-none" maxLength={2} />
                          <input value={editTagVal.name} onChange={e => setEditTagVal(p => ({ ...p, name: e.target.value }))}
                            className="w-24 bg-transparent text-sm text-white focus:outline-none border-b border-zinc-600"
                            onKeyDown={e => e.key === 'Enter' && saveTag(tag.id, group.id)} />
                          <button onClick={() => saveTag(tag.id, group.id)} className="text-xs text-amber-400 font-semibold">✓</button>
                          <button onClick={() => setEditingTag(null)} className="text-xs text-zinc-500">✕</button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm">{tag.emoji}</span>
                          <span className="text-xs font-medium text-zinc-300">{tag.name}</span>
                          <button onClick={() => { setEditingTag(tag.id); setEditTagVal({ name: tag.name, emoji: tag.emoji }) }}
                            className="text-zinc-600 hover:text-zinc-300 transition-colors ml-0.5">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button onClick={() => deleteTag(tag.id, group.id)}
                            className="text-zinc-600 hover:text-red-400 transition-colors">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {group.tags.length === 0 && (
                    <span className="text-xs text-zinc-600 italic">No tags yet</span>
                  )}
                </div>

                {/* Add tag */}
                <div className="flex gap-2">
                  <input value={newTagEmoji[group.id] ?? ''} onChange={e => setNewTagEmoji(p => ({ ...p, [group.id]: e.target.value }))}
                    placeholder="🏷️" className={`${inputCls} w-14 text-center text-sm`} maxLength={2} />
                  <input value={newTagName[group.id] ?? ''} onChange={e => setNewTagName(p => ({ ...p, [group.id]: e.target.value }))}
                    placeholder="Tag name…" className={`${inputCls} flex-1 text-sm`}
                    onKeyDown={e => e.key === 'Enter' && addTag(group.id)} />
                  <button onClick={() => addTag(group.id)} disabled={savingTag[group.id] || !newTagName[group.id]?.trim()}
                    className="px-3 py-2 text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl transition-colors disabled:opacity-50">
                    {savingTag[group.id] ? '…' : '+ Tag'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
