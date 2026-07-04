'use client'

import { useState, useEffect, useRef } from 'react'
import { resolveImageUrl, getInitials } from '@/lib/data'
import RichText from '@/components/RichText'
import FormatToolbar from '@/components/FormatToolbar'
import { confirmToast } from '@/lib/confirmToast'

interface Author { id: string; name: string; color: string; photo: string | null; role: string; clubRole: string | null }
interface Announcement { id: string; content: string; type: string; createdAt: string; editedAt?: string | null; isPinned: boolean; author: Author }

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Avatar({ author }: { author: Author }) {
  const photo = resolveImageUrl(author.photo)
  return photo ? (
    <img src={photo} alt={author.name} loading="lazy" className="w-9 h-9 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: author.color }}>
      {getInitials(author.name)}
    </div>
  )
}

interface Props {
  slug: string
  canAnnounce: boolean
  currentUserId?: string
  isAdmin?: boolean
  dark?: boolean
}

export default function ClubAnnouncements({ slug, canAnnounce, currentUserId, isAdmin, dark }: Props) {
  const [items, setItems]     = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError]     = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/posts?type=announcement`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setItems(data) })
      .finally(() => setLoading(false))
  }, [slug])

  async function submit() {
    if (!content.trim() || posting) return
    setPosting(true); setError('')
    const res = await fetch(`/app/api/clubs/${slug}/posts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type: 'announcement' }),
    })
    if (res.ok) {
      const item = await res.json()
      setItems(prev => [item, ...prev])
      setContent('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } else { const d = await res.json(); setError(d.error ?? 'Failed') }
    setPosting(false)
  }

  async function deleteItem(id: string) {
    if (!(await confirmToast('Delete this announcement?'))) return
    const res = await fetch(`/app/api/clubs/${slug}/posts/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setItems(prev => prev.filter(a => a.id !== id))
  }

  function startEdit(item: Announcement) {
    setEditingId(item.id)
    setEditDraft(item.content)
    setError('')
  }
  function cancelEdit() { setEditingId(null); setEditDraft('') }

  async function saveEdit(id: string) {
    if (!editDraft.trim() || savingEdit) return
    setSavingEdit(true); setError('')
    try {
      const res = await fetch(`/app/api/clubs/${slug}/posts/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editDraft }),
      })
      if (res.ok) {
        const updated = await res.json()
        setItems(prev => prev.map(a => a.id === id ? { ...a, content: updated.content, editedAt: updated.editedAt } : a))
        cancelEdit()
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to save')
      }
    } catch {
      setError('Failed to save')
    } finally {
      setSavingEdit(false)
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }

  const card    = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-4' : 'bg-white shadow-card rounded-2xl p-4'
  const itemCard = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ring-1 ring-amber-500/20' : 'bg-white shadow-card rounded-2xl p-4 ring-1 ring-amber-200'
  const skelCard = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-4' : 'bg-white shadow-card rounded-2xl p-4'
  const emptyCard = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center' : 'bg-white shadow-card rounded-2xl p-12 text-center'
  const textarea_ = dark ? 'text-zinc-200 placeholder-zinc-600' : 'text-gray-800 placeholder-gray-400'
  const divider  = dark ? 'border-zinc-800' : 'border-gray-100'
  const counter  = dark ? 'text-zinc-600' : 'text-gray-400'
  const author_  = dark ? 'text-white' : 'text-gray-900'
  const time_    = dark ? 'text-zinc-500' : 'text-gray-400'
  const del_     = dark ? 'text-zinc-600 hover:text-red-400' : 'text-gray-300 hover:text-red-400'
  const edit_    = dark ? 'text-zinc-500 hover:text-amber-400' : 'text-gray-400 hover:text-amber-600'
  const editBox  = dark ? 'bg-zinc-950 border-zinc-700 text-zinc-200' : 'bg-white border-gray-200 text-gray-800'
  const body_    = dark ? 'text-zinc-300' : 'text-gray-700'
  const empty_   = dark ? 'text-zinc-500' : 'text-gray-600'
  const skelBg   = dark ? 'bg-zinc-700' : 'bg-gray-200'

  return (
    <div className="space-y-5">
      {canAnnounce && (
        <div className={card}>
          <p className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-1">📢 Announcement</p>
          <FormatToolbar getEl={() => textareaRef.current} value={content} onChange={setContent} dark={dark} />
          <textarea ref={textareaRef} value={content} onChange={autoResize}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
            placeholder="Post an announcement to your club…"
            rows={3}
            className={`w-full text-sm resize-none focus:outline-none leading-relaxed ${textarea_}`}
            style={{ minHeight: 72 }} />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          <div className={`flex items-center justify-between mt-3 pt-3 border-t ${divider}`}>
            <span className={`text-xs ${content.length > 1800 ? 'text-red-500' : counter}`}>{content.length} / 2000</span>
            <button onClick={submit} disabled={!content.trim() || posting || content.length > 2000}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40">
              {posting ? 'Posting…' : 'Post announcement'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className={`${skelCard} animate-pulse`}>
              <div className="flex gap-3">
                <div className={`w-9 h-9 rounded-full ${skelBg} shrink-0`} />
                <div className="flex-1 space-y-2">
                  <div className={`h-3 ${skelBg} rounded w-1/4`} />
                  <div className={`h-3 ${skelBg} rounded w-full`} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className={emptyCard}>
          <span className="text-4xl block mb-3">📢</span>
          <p className={`${empty_} text-sm`}>No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const canDelete = currentUserId === item.author.id || isAdmin
            return (
              <div key={item.id} className={itemCard}>
                <div className="flex items-center gap-1 text-xs font-semibold text-amber-600 mb-2">
                  <span>📢</span> Announcement
                </div>
                <div className="flex gap-3">
                  <Avatar author={item.author} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${author_}`}>{item.author.name}</span>
                      <span className={`text-xs ${time_}`}>{formatRelative(item.createdAt)}</span>
                      {item.editedAt && <span className={`text-[11px] italic ${time_}`}>· edited</span>}
                      {(canDelete || currentUserId === item.author.id) && editingId !== item.id && (
                        <span className="ml-auto flex items-center gap-3">
                          {currentUserId === item.author.id && (
                            <button onClick={() => startEdit(item)}
                              className={`text-xs ${edit_} transition-colors`}>Edit</button>
                          )}
                          {canDelete && (
                            <button onClick={() => deleteItem(item.id)}
                              className={`text-xs ${del_} transition-colors`}>Delete</button>
                          )}
                        </span>
                      )}
                    </div>
                    {editingId === item.id ? (
                      <div className="mt-1.5">
                        <FormatToolbar getEl={() => editRef.current} value={editDraft} onChange={setEditDraft} dark={dark} />
                        <textarea
                          ref={editRef}
                          value={editDraft}
                          onChange={e => setEditDraft(e.target.value)}
                          rows={4}
                          maxLength={2000}
                          autoFocus
                          className={`w-full text-sm rounded-xl border px-3 py-2 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-amber-400 ${editBox}`}
                        />
                        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                        <div className="flex items-center gap-2 mt-2">
                          <button onClick={() => saveEdit(item.id)} disabled={!editDraft.trim() || savingEdit}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={cancelEdit}
                            className={`px-3 py-1.5 text-xs font-semibold ${edit_} transition-colors`}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p className={`text-sm ${body_} mt-1.5 leading-relaxed whitespace-pre-wrap break-words`}>
                        <RichText text={item.content} />
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
