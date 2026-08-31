'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

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
  // Author can be null if a future migration relaxes the FK to SetNull.
  // Defensive render path below.
  author:       { name: string } | null
}

const categoryColors: Record<string, string> = {
  'Community':     'bg-amber-100 text-amber-700',
  'Club Stories':  'bg-violet-100 text-violet-700',
  'Events':        'bg-blue-100 text-blue-700',
  'Istanbul Guide':'bg-green-100 text-green-700',
  'Tips':          'bg-pink-100 text-pink-700',
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
  const [filter,  setFilter]  = useState<'all' | 'published' | 'draft' | 'submitted'>('all')
  const [deleting, setDeleting] = useState<string | null>(null)
  // Inline-confirm replaces window.confirm — misclick doesn't nuke
  // the post immediately.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

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

  const filtered = posts.filter(p => filter === 'all' || p.status === filter)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Articles</h1>
          <p className="text-zinc-400 text-sm mt-0.5">{posts.length} total · {posts.filter(p => p.status === 'published').length} published</p>
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

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5">
        {/* 'submitted' = member-written stories awaiting review (the
            /share-story flow) — edit, then publish like any draft. */}
        {(['all', 'published', 'draft', 'submitted'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
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
            <div key={post.id} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${categoryColors[post.category] ?? 'bg-zinc-700 text-zinc-300'}`}>
                    {post.category}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    post.status === 'published' ? 'bg-green-900/50 text-green-400'
                      : post.status === 'submitted' ? 'bg-amber-900/50 text-amber-400'
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
                  {post.publishedAt
                    ? `Published ${timeAgo(post.publishedAt)}`
                    : `Draft · created ${timeAgo(post.createdAt)}`}
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

              <div className="flex items-center gap-2 shrink-0">
                {post.status === 'published' && (
                  <a
                    href={`/app/posts/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                  >
                    View ↗
                  </a>
                )}
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  Edit
                </Link>
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
