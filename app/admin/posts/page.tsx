'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { reviewQueue } from '@/lib/handbook-review'

interface SourceWatch {
  changes:     { postId: string; slug: string; title: string; url: string; label: string; changedAt: string; diff: string | null }[]
  unreachable: { url: string; error: string | null; checkedAt: string | null; articles: { slug: string; title: string }[] }[]
  watched:     number
  lastChecked: string | null
}

interface Post {
  id:           string
  title:        string
  slug:         string
  excerpt:      string | null
  category:     string
  status:       string
  publishedAt:  string | null
  createdAt:    string
  updatedAt:    string
  views:        number
  kind:         string
  lastReviewedAt:     string | null
  reviewIntervalDays: number | null
  // Author can be null if a future migration relaxes the FK to SetNull.
  // Defensive render path below.
  author:       { name: string } | null
}

const categoryColors: Record<string, string> = {
  'Community':    'bg-amber-100 text-amber-700',
  'Club Stories': 'bg-violet-100 text-violet-700',
  'Events':       'bg-blue-100 text-blue-700',
  'City Guide':   'bg-green-100 text-green-700',
  'Tips':         'bg-pink-100 text-pink-700',
  'Working from': 'bg-sky-100 text-sky-700',
  'Students':     'bg-indigo-100 text-indigo-700',
  'Expats':       'bg-teal-100 text-teal-700',
  'Digital nomads': 'bg-cyan-100 text-cyan-700',
  'Travelers':   'bg-orange-100 text-orange-700',
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60)   return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AdminPostsPage() {
  const [posts,   setPosts]   = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<'all' | 'published' | 'draft' | 'submitted' | 'declined'>('all')
  // The weekly source watch (lib/handbookSources): articles whose official
  // source changed since their last review, and sources that stopped loading.
  const [sourceWatch, setSourceWatch] = useState<SourceWatch | null>(null)
  useEffect(() => {
    fetch('/app/api/admin/handbook-sources', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.changes)) setSourceWatch(d) })
      .catch(() => {})
  }, [])
  const [deleting, setDeleting] = useState<string | null>(null)
  // Inline-confirm replaces window.confirm — misclick doesn't nuke
  // the post immediately.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // Same inline pattern for declining a member story: the row opens a note
  // box (optional, goes to the writer) with Confirm/Cancel — no modal.
  const [declineFor,  setDeclineFor]  = useState<string | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declining,   setDeclining]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/app/api/admin/posts')
      .then(async r => {
        // Previously `.then(setPosts)` was called on whatever the
        // response body deserialized to. A failed GET returns
        // { error: '...' } and the later `.filter(...)` blew up on a
        // non-array. Guard the parse here.
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          toast.error(d?.error ?? `Couldn't load articles (HTTP ${r.status})`)
          return []
        }
        const d = await r.json()
        return Array.isArray(d) ? d : []
      })
      .then(setPosts)
      .catch(() => toast.error('Network error — could not load articles'))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      const res = await fetch(`/app/api/admin/posts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to delete post')
        return
      }
      setPosts(prev => prev.filter(p => p.id !== id))
      setConfirmDelete(null)
      toast.success('Post deleted')
    } finally {
      setDeleting(null)
    }
  }

  async function handleDecline(id: string) {
    setDeclining(id)
    try {
      const res = await fetch(`/app/api/admin/posts/${id}/decline`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note: declineNote.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to decline story')
        return
      }
      setPosts(prev => prev.map(p => p.id === id ? { ...p, status: 'declined' } : p))
      setDeclineFor(null)
      setDeclineNote('')
      toast.success('Declined — the writer has been told')
    } catch {
      toast.error('Network error — could not decline story')
    } finally {
      setDeclining(null)
    }
  }

  const filtered = posts.filter(p => filter === 'all' || p.status === filter)
  const awaiting = posts.filter(p => p.status === 'submitted').length
  // The Handbook's review queue (lib/handbook-review): the staff view that
  // did not exist — "Reviewed today" lives on each article page, and nothing
  // said which articles needed it.
  const queue    = reviewQueue(posts)
  const queued   = [...queue.overdue, ...queue.unreviewed, ...queue.soon]

  // "Draft · created …" was shown for anything unpublished, which hid the
  // review queue's two states from the one line staff actually scan.
  function metaLine(post: Post): string {
    if (post.publishedAt)              return `Published ${timeAgo(post.publishedAt)}`
    if (post.status === 'submitted')   return `Submitted · ${timeAgo(post.createdAt)}`
    if (post.status === 'declined')    return `Declined · ${timeAgo(post.updatedAt || post.createdAt)}`
    return `Draft · created ${timeAgo(post.createdAt)}`
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Stories &amp; Handbook</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {posts.length} total · {posts.filter(p => p.status === 'published').length} published
            {awaiting > 0 && <> · <span className="text-amber-400">{awaiting} awaiting review</span></>}
          </p>
        </div>
        <Link
          href="/admin/posts/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New article
        </Link>
      </div>

      {sourceWatch && (sourceWatch.changes.length > 0 || sourceWatch.unreachable.length > 0) && (
        <section className="mb-6 bg-zinc-800 border border-amber-800/60 rounded-xl p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-sm font-bold text-zinc-100">Sources changed</h2>
            <p className="text-xs text-zinc-400">
              {sourceWatch.watched} official pages watched weekly
              {sourceWatch.lastChecked && <> · last checked {timeAgo(sourceWatch.lastChecked)}</>}
            </p>
          </div>
          {sourceWatch.changes.length > 0 ? (
            <ul className="space-y-3">
              {sourceWatch.changes.slice(0, 20).map(c => (
                <li key={`${c.postId}-${c.url}`} className="text-sm">
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300">source changed</span>
                    {/* The article page holds the "Reviewed today" button, which clears this. */}
                    <a href={`/app/handbook/${c.slug}`} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-zinc-200 hover:text-amber-400">{c.title}</a>
                    <span className="ml-auto shrink-0 text-xs text-zinc-500">{timeAgo(c.changedAt)}</span>
                  </div>
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="block mt-1 ml-1 text-xs text-zinc-400 hover:text-amber-400 truncate">{c.label}</a>
                  {c.diff && <pre className="mt-1 ml-1 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-words bg-zinc-900/60 rounded-lg px-3 py-2">{c.diff}</pre>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">No article's sources have changed since its last review.</p>
          )}
          {sourceWatch.changes.length > 20 && <p className="text-xs text-zinc-500 mt-2">+ {sourceWatch.changes.length - 20} more</p>}
          {sourceWatch.unreachable.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs font-semibold text-zinc-300 cursor-pointer">
                {sourceWatch.unreachable.length} cited source{sourceWatch.unreachable.length === 1 ? '' : 's'} couldn&apos;t be loaded last check
              </summary>
              <ul className="mt-2 space-y-1.5">
                {sourceWatch.unreachable.map(u => (
                  <li key={u.url} className="text-xs text-zinc-400">
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className="hover:text-amber-400 break-all">{u.url}</a>
                    <span className="text-zinc-500"> — {u.error}{u.articles.length > 0 && <> · in {u.articles.map(a => a.title).join(', ')}</>}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {queued.length > 0 && (
        <section className="mb-6 bg-zinc-800 border border-zinc-700 rounded-xl p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-sm font-bold text-zinc-100">Handbook review queue</h2>
            <p className="text-xs text-zinc-400">
              {queue.overdue.length} overdue · {queue.unreviewed.length} never reviewed · {queue.soon.length} due soon
            </p>
          </div>
          <ul className="space-y-1.5">
            {queued.slice(0, 20).map(p => {
              const state = queue.overdue.includes(p) ? 'overdue' : queue.unreviewed.includes(p) ? 'never reviewed' : 'due soon'
              return (
                <li key={p.id} className="flex items-center gap-3 text-sm">
                  <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    state === 'overdue' ? 'bg-red-900/50 text-red-300' : state === 'never reviewed' ? 'bg-zinc-700 text-zinc-300' : 'bg-amber-900/50 text-amber-300'}`}>
                    {state}
                  </span>
                  {/* The article page holds the "Reviewed today" button. */}
                  <a href={`/app/handbook/${p.slug}`} target="_blank" rel="noopener noreferrer"
                    className="min-w-0 truncate text-zinc-200 hover:text-amber-400">{p.title}</a>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500">{p.category}</span>
                </li>
              )
            })}
          </ul>
          {queued.length > 20 && <p className="text-xs text-zinc-500 mt-2">+ {queued.length - 20} more</p>}
        </section>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto scrollbar-hide">
        {/* 'submitted' = member-written stories awaiting review (the
            /share-story flow) — edit, then publish like any draft, or
            decline. 'declined' keeps the ones we said no to. */}
        {(['all', 'published', 'draft', 'submitted', 'declined'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-zinc-800 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-zinc-500">
          <div className="text-4xl mb-3">📝</div>
          <p className="font-semibold">No articles yet</p>
          <p className="text-sm mt-1">Create your first article to share with the community.</p>
          <Link href="/admin/posts/new" className="mt-5 inline-block px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
            Write first article
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(post => (
            <div key={post.id} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${categoryColors[post.category] ?? 'bg-zinc-700 text-zinc-300'}`}>
                    {post.category}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    post.status === 'published' ? 'bg-green-900/50 text-green-400'
                      : post.status === 'submitted' ? 'bg-amber-900/50 text-amber-400'
                      : post.status === 'declined'  ? 'bg-zinc-800 text-zinc-500 line-through'
                      : 'bg-zinc-700 text-zinc-400'
                  }`}>
                    {post.status}
                  </span>
                </div>
                <p className="font-semibold text-zinc-100 truncate">{post.title}</p>
                {post.excerpt && (
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">{post.excerpt}</p>
                )}
                <p className="text-xs text-zinc-500 mt-1">
                  By {post.author?.name ?? 'Unknown'} ·{' '}
                  {metaLine(post)}
                  {/* Surface updatedAt when an article has been edited
                      after creation/publish — was previously hidden. */}
                  {post.updatedAt && post.updatedAt !== (post.publishedAt ?? post.createdAt) && (
                    <> · edited {timeAgo(post.updatedAt)}</>
                  )}
                  {post.status === 'published' && (
                    <> · 👁 {post.views.toLocaleString()} view{post.views === 1 ? '' : 's'}</>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                {/* Each kind has its own page, and /posts no longer serves a
                    handbook article (it did, by accident — a second URL). The
                    story page renders unpublished rows for staff with a
                    preview banner; the handbook page does not, so a handbook
                    draft has no link rather than a dead one. */}
                {(post.kind !== 'handbook' || post.status === 'published') && (
                  <a
                    href={post.kind === 'handbook' ? `/app/handbook/${post.slug}` : `/app/posts/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                  >
                    {post.status === 'published' ? 'View ↗' : 'Preview ↗'}
                  </a>
                )}
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  Edit
                </Link>
                {post.status === 'submitted' && declineFor !== post.id && (
                  <button
                    onClick={() => { setConfirmDelete(null); setDeclineFor(post.id); setDeclineNote('') }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                  >
                    Decline
                  </button>
                )}
                {confirmDelete === post.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(post.id)}
                      disabled={deleting === post.id}
                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {deleting === post.id ? '…' : 'Delete?'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(post.id)}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>

              {/* Decline note — opens under the row, full width, so the
                  textarea isn't squeezed into the button strip. */}
              {declineFor === post.id && (
                <div className="w-full sm:basis-full border-t border-zinc-700 pt-3 mt-1 space-y-2">
                  <textarea
                    value={declineNote}
                    onChange={e => setDeclineNote(e.target.value.slice(0, 300))}
                    rows={2}
                    maxLength={300}
                    placeholder="Optional note to the writer — what would make it publishable?"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors resize-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-500">{declineNote.length}/300 · sent to the writer as a notification</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDecline(post.id)}
                        disabled={declining === post.id}
                        className="px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-600 text-zinc-100 hover:bg-zinc-500 transition-colors disabled:opacity-50"
                      >
                        {declining === post.id ? '…' : 'Confirm decline'}
                      </button>
                      <button
                        onClick={() => { setDeclineFor(null); setDeclineNote('') }}
                        disabled={declining === post.id}
                        className="px-2 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
