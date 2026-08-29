'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import AvatarImg from '@/components/AvatarImg'
import { avatarUrl } from '@/lib/data'
import { BOARD_POST_TYPES, type BoardPostType } from '@/lib/board'

interface Post {
  id: string; type: BoardPostType; title: string; body: string
  createdAt: string; replyCount: number
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// Club conversations (Clubs brief §18/§19) — canonical Board posts tagged
// to the club: the same thread appears on the community Board (public clubs)
// and here. Replaces the legacy club wall; full threads open on the Board
// via the ?post= deep link.
export default function ClubConversations({ slug, isMember }: { slug: string; isMember: boolean }) {
  const { isLoggedIn } = useAuth()
  const [posts,   setPosts]   = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [open,    setOpen]    = useState(false)
  const [type,    setType]    = useState<BoardPostType>('question')
  const [title,   setTitle]   = useState('')
  const [body,    setBody]    = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    fetch(`/app/api/board?club=${encodeURIComponent(slug)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { posts: [] })
      .then(d => setPosts((d.posts ?? []).map((p: Post & { replyCount?: number }) => p)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

  async function submit() {
    if (posting || !title.trim()) { if (!title.trim()) toast.error('Say what your post is about'); return }
    setPosting(true)
    try {
      const res = await fetch('/app/api/board', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, body, club: slug }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Posted — it also appears on the community Board')
      posthog.capture('club_conversation_created', { club: slug })
      setTitle(''); setBody(''); setOpen(false)
      // Refresh the list to include the new post with its server shape.
      const refreshed = await fetch(`/app/api/board?club=${encodeURIComponent(slug)}`, { credentials: 'include' }).then(r => r.json()).catch(() => null)
      if (refreshed?.posts) setPosts(refreshed.posts)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Composer — members of the club only (the API enforces it too). */}
      {isLoggedIn && isMember && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          {!open ? (
            <button onClick={() => setOpen(true)}
              className="w-full text-left text-sm text-gray-500 px-3 py-2 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
              + Start a conversation…
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                {BOARD_POST_TYPES.map(t => (
                  <button key={t.value} onClick={() => setType(t.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                      type === t.value ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200'
                    }`}>
                    <span aria-hidden="true">{t.emoji}</span> {t.label}
                  </button>
                ))}
              </div>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
                placeholder="What's it about?"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={1000} rows={3}
                placeholder="Details (optional)"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
                <button onClick={submit} disabled={posting}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors">
                  {posting ? '…' : 'Post'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map(i => <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 h-20 animate-pulse" />)}
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center">
          <p className="font-bold text-gray-900">No conversations yet.</p>
          <p className="text-sm text-gray-600 mt-1">
            {isMember ? 'Ask a question, share a find — get something going.' : 'Join the club to start one.'}
          </p>
        </div>
      ) : (
        posts.map(p => (
          <Link key={p.id} href={`/board?post=${p.id}`}
            className="flex items-start gap-3 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
            <AvatarImg src={avatarUrl(p.user.profilePhoto, 96)} name={p.user.name} color={p.user.color}
              size="w-10 h-10" textSize="text-sm" className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">{p.user.name.split(' ')[0]} · {timeAgo(p.createdAt)}</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5 group-hover:text-amber-700 transition-colors">{p.title}</p>
              {p.body && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{p.body}</p>}
            </div>
            <span className="shrink-0 text-xs font-bold text-amber-600">
              {p.replyCount > 0 ? `💬 ${p.replyCount}` : 'Reply →'}
            </span>
          </Link>
        ))
      )}
    </div>
  )
}
