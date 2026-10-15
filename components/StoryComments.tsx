'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import MentionTextarea from '@/components/MentionTextarea'
import RichText from '@/components/RichText'

// Member comments under a story. Flat, members only.
//
// A guest sees the count and a sign-in prompt, never the text (the API answers
// 401). With no comments yet the section is a single "Add a comment" button
// rather than an empty box, so a quiet story does not look abandoned.
// Members can like, edit their own, @mention (same composer as the walls),
// delete and report.

interface Comment {
  id: string
  body: string
  createdAt: string
  editedAt: string | null
  likeCount: number
  liked: boolean
  isMine: boolean
  canRemove: boolean
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

interface Props { slug: string; initialCount: number; isLoggedIn: boolean }

const REASONS = [
  { value: 'spam',          label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'scam',          label: 'Scam' },
  { value: 'other',         label: 'Other' },
]

function ago(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function StoryComments({ slug, initialCount, isLoggedIn }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const base     = `/app/api/posts/${encodeURIComponent(slug)}/comments`

  const [comments, setComments] = useState<Comment[] | null>(null)
  const [count,    setCount]    = useState(initialCount)
  const [composing, setComposing] = useState(false)
  const [text,     setText]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const [reporting, setReporting] = useState<string | null>(null)
  const [editing,  setEditing]  = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    if (!isLoggedIn || initialCount === 0) return
    let live = true
    fetch(base, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live || !d) return
        setComments(d.comments); setCount(d.comments.length)
        // A bell link lands on #comments before the list exists, so the
        // browser's own anchor jump misses; scroll once the content is in.
        if (window.location.hash === '#comments') {
          requestAnimationFrame(() => document.getElementById('comments')?.scrollIntoView({ block: 'start' }))
        }
      })
      .catch(() => {})
    return () => { live = false }
  }, [base, isLoggedIn, initialCount])

  function signIn() {
    router.push(`/login?next=${encodeURIComponent(pathname + window.location.search)}`)
  }

  async function submit() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const res = await fetch(base, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Could not post that'); return }
      setComments(prev => [...(prev ?? []), d.comment])
      setCount(c => c + 1)
      setText('')
    } catch {
      toast.error('Could not post that — check your connection')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(id: string) {
    const body = editText.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${base}/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Could not save that'); return }
      setComments(prev => (prev ?? []).map(c => c.id === id ? { ...c, body: d.body, editedAt: d.editedAt } : c))
      setEditing(null)
    } catch {
      toast.error('Could not save that — check your connection')
    } finally {
      setBusy(false)
    }
  }

  async function toggleLike(c: Comment) {
    const prev = comments
    setComments(cs => (cs ?? []).map(x => x.id === c.id ? { ...x, liked: !x.liked, likeCount: x.likeCount + (x.liked ? -1 : 1) } : x))
    try {
      const res = await fetch(`${base}/${c.id}/like`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error()
      const d = await res.json()
      setComments(cs => (cs ?? []).map(x => x.id === c.id ? { ...x, liked: d.liked, likeCount: d.count } : x))
    } catch {
      setComments(prev)
      toast.error('Could not save that — check your connection')
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) throw new Error()
      setComments(prev => (prev ?? []).filter(c => c.id !== id))
      setCount(c => Math.max(0, c - 1))
    } catch {
      toast.error('Could not remove that')
    }
  }

  async function report(id: string, reason: string) {
    setReporting(null)
    try {
      const res = await fetch(`${base}/${id}/report`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Could not send the report'); return }
      toast.success('Thanks — a moderator will take a look')
    } catch {
      toast.error('Could not send the report')
    }
  }

  const fieldCls = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300'

  const composer = (
    <div className="mt-4">
      <MentionTextarea
        value={text}
        onChange={setText}
        maxLength={1000}
        rows={3}
        placeholder="Add a comment… (@ to mention a member)"
        className={fieldCls}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Posting…' : 'Post comment'}
        </button>
        {count === 0 && (
          <button onClick={() => { setComposing(false); setText('') }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        )}
      </div>
    </div>
  )

  return (
    <section id="comments" className="mt-10 pt-8 border-t border-gray-100 scroll-mt-20">
      {count > 0 && (
        <h2 className="text-base font-bold text-gray-900">
          {count} {count === 1 ? 'comment' : 'comments'}
        </h2>
      )}

      {!isLoggedIn ? (
        <button onClick={signIn} className="mt-2 text-sm text-amber-700 font-medium hover:underline">
          Sign in to {count > 0 ? 'read and join the conversation' : 'leave a comment'}
        </button>
      ) : (
        <>
          {comments && comments.length > 0 && (
            <ul className="mt-4 space-y-4">
              {comments.map(c => (
                <li key={c.id} className="flex gap-3">
                  {c.user.profilePhoto
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.user.profilePhoto} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    : <span className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: c.user.color }}>{c.user.name.charAt(0).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold text-gray-900">{c.user.name}</span>
                      <span className="text-gray-400"> · {ago(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                    </p>
                    {editing === c.id ? (
                      <div className="mt-1">
                        <MentionTextarea value={editText} onChange={setEditText} maxLength={1000} rows={3} className={fieldCls} />
                        <div className="mt-2 flex items-center gap-3 text-sm">
                          <button onClick={() => saveEdit(c.id)} disabled={busy || !editText.trim()} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-50">Save</button>
                          <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-gray-700">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-wrap break-words"><RichText text={c.body} /></p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                      <button
                        onClick={() => toggleLike(c)}
                        aria-pressed={c.liked}
                        className={c.liked ? 'text-rose-500 font-semibold' : 'hover:text-rose-500'}
                      >
                        {c.liked ? '♥' : '♡'}{c.likeCount > 0 ? ` ${c.likeCount}` : ' Like'}
                      </button>
                      {c.isMine && editing !== c.id && (
                        <button onClick={() => { setEditing(c.id); setEditText(c.body) }} className="hover:text-gray-600">Edit</button>
                      )}
                      {c.canRemove && <button onClick={() => remove(c.id)} className="hover:text-red-600">Delete</button>}
                      {!c.isMine && (
                        reporting === c.id ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {REASONS.map(r => (
                              <button key={r.value} onClick={() => report(c.id, r.value)} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">{r.label}</button>
                            ))}
                            <button onClick={() => setReporting(null)} className="hover:text-gray-600">Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => setReporting(c.id)} className="hover:text-gray-600">Report</button>
                        )
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {count > 0 || composing
            ? composer
            : (
              <button onClick={() => setComposing(true)} className="text-sm text-amber-700 font-medium hover:underline">
                Add a comment
              </button>
            )}
        </>
      )}
    </section>
  )
}
