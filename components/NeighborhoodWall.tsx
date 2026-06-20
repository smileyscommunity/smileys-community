'use client'

import { useState, useEffect, useRef } from 'react'
import { resolveImageUrl, getInitials } from '@/lib/data'
import MentionTextarea, { MentionInput } from '@/components/MentionTextarea'

function renderContent(text: string) {
  const parts = text.split(/(@\w+)/g)
  return parts.map((part, i) =>
    /^@\w+$/.test(part)
      ? <span key={i} className="font-semibold text-amber-600">{part}</span>
      : <span key={i}>{part}</span>
  )
}

interface Author {
  id: string; name: string; color: string; photo: string | null; role: string
}
interface Reaction { emoji: string; count: number; reactedByMe: boolean }
interface Reply    { id: string; content: string; createdAt: string; author: Author }
interface Post {
  id: string; content: string; imageUrl: string | null; isPinned: boolean
  createdAt: string; author: Author; reactions: Reaction[]; replies: Reply[]
  replyCount: number
}

const REACTIONS = ['❤️', '👍', '🔥', '😂']

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return 'just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Avatar({ author }: { author: Author }) {
  const photo = resolveImageUrl(author.photo)
  return photo ? (
    <img src={photo} alt={author.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
      style={{ backgroundColor: author.color }}>
      {getInitials(author.name)}
    </div>
  )
}

function PostRow({
  post, slug, myId, isStaff,
  onDelete, onReact, onReply, onDeleteReply, onPin,
}: {
  post: Post; slug: string; myId: string; isStaff: boolean
  onDelete:      (id: string) => void
  onReact:       (id: string, emoji: string, likes: { userId: string; emoji: string }[]) => void
  onReply:       (postId: string, reply: Reply) => void
  onDeleteReply: (postId: string, replyId: string) => void
  onPin:         (id: string, pinned: boolean) => void
}) {
  const [showReplies,    setShowReplies]    = useState(false)
  const [replyOpen,      setReplyOpen]      = useState(false)
  const [replyText,      setReplyText]      = useState('')
  const [replying,       setReplying]       = useState(false)
  const [reactionMenu,   setReactionMenu]   = useState(false)
  const [menu,           setMenu]           = useState(false)
  const [allReplies,     setAllReplies]     = useState<Reply[] | null>(null)
  const [loadingReplies, setLoadingReplies] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const canEdit = post.author.id === myId || isStaff

  useEffect(() => {
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function react(emoji: string) {
    setReactionMenu(false)
    const res = await fetch(`/app/api/neighborhoods/${slug}/posts/${post.id}/like`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    })
    if (res.ok) { const d = await res.json(); onReact(post.id, emoji, d.likes) }
  }

  async function deletePost() {
    setMenu(false)
    if (!confirm('Delete this post?')) return
    const res = await fetch(`/app/api/neighborhoods/${slug}/posts/${post.id}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) onDelete(post.id)
  }

  async function pinPost() {
    setMenu(false)
    const res = await fetch(`/app/api/neighborhoods/${slug}/posts/${post.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPinned: !post.isPinned }),
    })
    if (res.ok) onPin(post.id, !post.isPinned)
  }

  async function submitReply() {
    if (!replyText.trim() || replying) return
    setReplying(true)
    const res = await fetch(`/app/api/neighborhoods/${slug}/posts/${post.id}/replies`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: replyText.trim() }),
    })
    if (res.ok) {
      const r = await res.json()
      onReply(post.id, r)
      setReplyText(''); setReplyOpen(false); setShowReplies(true)
    }
    setReplying(false)
  }

  async function deleteReply(replyId: string) {
    const res = await fetch(`/app/api/neighborhoods/${slug}/posts/${post.id}/replies/${replyId}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) onDeleteReply(post.id, replyId)
  }

  const myReaction  = post.reactions.find(r => r.reactedByMe)?.emoji ?? null
  const allReactions = post.reactions.filter(r => r.count > 0)

  return (
    <div className={`px-4 py-3 ${post.isPinned ? 'bg-amber-50/50' : ''}`}>
      {post.isPinned && (
        <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-500 mb-1.5">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
          </svg>
          Pinned
        </div>
      )}

      <div className="flex items-start gap-2.5">
        <Avatar author={post.author} />
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-gray-900 truncate">{post.author.name}</span>
            {(post.author.role === 'admin' || post.author.role === 'moderator') && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">Staff</span>
            )}
            <span className="text-[11px] text-gray-400 ml-auto shrink-0">{timeAgo(post.createdAt)}</span>
            {canEdit && (
              <div className="relative shrink-0" ref={menuRef}>
                <button onClick={() => setMenu(v => !v)}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-600 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
                {menu && (
                  <div className="absolute right-0 top-5 bg-white border border-gray-100 rounded-xl shadow-lg z-20 py-1 min-w-[130px]">
                    {isStaff && (
                      <button onClick={pinPost}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                        📌 {post.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                    )}
                    <button onClick={deletePost}
                      className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Content */}
          {post.content && (
            <p className="text-xs text-gray-700 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">{renderContent(post.content)}</p>
          )}
          {post.imageUrl && (
            <img src={resolveImageUrl(post.imageUrl)} alt="" className="mt-1.5 rounded-lg max-h-48 object-cover w-full" />
          )}

          {/* Reactions + actions row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {allReactions.map(r => (
              <button key={r.emoji} onClick={() => react(r.emoji)}
                className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  r.reactedByMe ? 'bg-amber-50 border-amber-200 text-amber-700 font-semibold' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                {r.emoji} {r.count}
              </button>
            ))}

            <div className="relative">
              <button onClick={() => setReactionMenu(v => !v)}
                className="text-[11px] text-gray-400 hover:text-amber-500 transition-colors px-1">
                {myReaction ?? '+'} React
              </button>
              {reactionMenu && (
                <div className="absolute bottom-6 left-0 bg-white border border-gray-100 rounded-2xl shadow-xl z-20 flex gap-1 p-1.5">
                  {REACTIONS.map(e => (
                    <button key={e} onClick={() => react(e)}
                      className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-lg">
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => { setReplyOpen(v => !v); setShowReplies(true) }}
              className="text-[11px] text-gray-400 hover:text-amber-500 transition-colors px-1">
              💬 Reply
            </button>

            {post.replyCount > 0 && (
              <button onClick={() => setShowReplies(v => !v)}
                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors ml-auto">
                {showReplies ? 'Hide' : `${post.replyCount} repl${post.replyCount === 1 ? 'y' : 'ies'}`}
              </button>
            )}
          </div>

          {/* Replies */}
          {showReplies && (
            <div className="mt-2 space-y-2 pl-3 border-l-2 border-gray-100">
              {(allReplies ?? post.replies).map(r => (
                <div key={r.id} className="flex items-start gap-1.5 group">
                  <Avatar author={r.author} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-gray-900">{r.author.name}</span>
                      <span className="text-[10px] text-gray-400">{timeAgo(r.createdAt)}</span>
                      {(r.author.id === myId || isStaff) && (
                        <button onClick={() => deleteReply(r.id)}
                          className="ml-auto text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                          ✕
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed break-words">{renderContent(r.content)}</p>
                  </div>
                </div>
              ))}
              {!allReplies && post.replyCount > post.replies.length && (
                <button
                  onClick={async () => {
                    setLoadingReplies(true)
                    const res = await fetch(`/app/api/neighborhoods/${slug}/posts/${post.id}/replies`, { credentials: 'include' })
                    if (res.ok) setAllReplies(await res.json())
                    setLoadingReplies(false)
                  }}
                  className="text-[11px] text-amber-500 hover:text-amber-600 font-medium transition-colors">
                  {loadingReplies ? 'Loading…' : `Show all ${post.replyCount} replies`}
                </button>
              )}
            </div>
          )}

          {/* Reply compose */}
          {replyOpen && (
            <div className="mt-1.5 pl-3 border-l-2 border-amber-200">
              <div className="flex gap-1.5 items-center">
                <MentionInput value={replyText} onChange={setReplyText}
                  onKeyDown={e => { if (e.key === 'Enter') submitReply(); if (e.key === 'Escape') setReplyOpen(false) }}
                  placeholder="Reply… (Enter to post)"
                  maxLength={1000} autoFocus
                  className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 text-gray-900 placeholder-gray-400"
                />
                <button onClick={submitReply} disabled={!replyText.trim() || replying}
                  className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors shrink-0">
                  {replying ? '…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Wall ─────────────────────────────────────────────────────────────────

interface Props {
  slug:    string
  myId:    string | null
  isStaff: boolean
  name:    string
}

const REACTIONS_KEY = ['❤️', '👍', '🔥', '😂']

function buildReactions(likes: { userId: string; emoji: string }[], myId?: string) {
  const counts: Record<string, number> = {}
  let myEmoji: string | null = null
  for (const l of likes) {
    counts[l.emoji] = (counts[l.emoji] ?? 0) + 1
    if (l.userId === myId) myEmoji = l.emoji
  }
  return REACTIONS_KEY
    .map(e => ({ emoji: e, count: counts[e] ?? 0, reactedByMe: myEmoji === e }))
    .filter(r => r.count > 0)
}

export default function NeighborhoodWall({ slug, myId, isStaff, name }: Props) {
  const [posts,          setPosts]          = useState<Post[]>([])
  const [loading,        setLoading]        = useState(true)
  const [text,           setText]           = useState('')
  const [posting,        setPosting]        = useState(false)
  const [error,          setError]          = useState('')
  const [composeOpen,    setComposeOpen]    = useState(false)

  useEffect(() => {
    fetch(`/app/api/neighborhoods/${slug}/posts`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPosts(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

  async function submit() {
    if (!text.trim() || posting) return
    setPosting(true); setError('')
    const res = await fetch(`/app/api/neighborhoods/${slug}/posts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.trim() }),
    })
    if (res.ok) {
      const p = await res.json()
      setPosts(prev => [p, ...prev])
      setText(''); setComposeOpen(false)
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to post')
    }
    setPosting(false)
  }

  function onDelete(id: string)      { setPosts(prev => prev.filter(p => p.id !== id)) }

  function onReact(postId: string, emoji: string, likes: { userId: string; emoji: string }[]) {
    setPosts(prev => prev.map(p =>
      p.id !== postId ? p : { ...p, reactions: buildReactions(likes, myId ?? undefined) }
    ))
  }

  function onReply(postId: string, reply: Reply) {
    setPosts(prev => prev.map(p =>
      p.id !== postId ? p : { ...p, replies: [...p.replies, reply] }
    ))
  }

  function onDeleteReply(postId: string, replyId: string) {
    setPosts(prev => prev.map(p =>
      p.id !== postId ? p : { ...p, replies: p.replies.filter(r => r.id !== replyId) }
    ))
  }

  function onPin(postId: string, isPinned: boolean) {
    setPosts(prev => {
      const updated = prev.map(p => p.id !== postId ? p : { ...p, isPinned })
      return [...updated].sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))
    })
  }

  if (!myId) {
    return (
      <div className="text-center py-8 text-gray-600 text-sm">
        Log in to see and post on the {name} wall.
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* Compose */}
      <div className="p-3 border-b border-gray-100">
        {!composeOpen ? (
          <button
            onClick={() => setComposeOpen(true)}
            className="w-full text-left text-sm text-gray-400 bg-gray-50 hover:bg-gray-100 transition-colors rounded-xl px-3 py-2.5">
            What's happening in {name}?
          </button>
        ) : (
          <div>
            <MentionTextarea value={text} onChange={setText}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
              placeholder={`Share a tip, event, or shout-out in ${name}…`}
              rows={3} maxLength={2000} autoFocus
              className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-amber-400 resize-none leading-relaxed"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">{text.length > 0 ? `${text.length} / 2000` : '⌘+Enter to post'}</span>
              <div className="flex gap-2">
                <button onClick={() => { setComposeOpen(false); setText(''); setError('') }}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-700 transition-colors">
                  Cancel
                </button>
                <button onClick={submit} disabled={!text.trim() || posting}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors">
                  {posting ? 'Posting…' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="divide-y divide-gray-50">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-4 py-3 animate-pulse">
              <div className="flex gap-2.5">
                <div className="w-7 h-7 bg-gray-200 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 bg-gray-200 rounded w-1/4" />
                  <div className="h-2.5 bg-gray-100 rounded w-3/4" />
                  <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-3xl mb-2">📝</div>
          <p className="text-gray-600 text-sm font-medium">No posts yet</p>
          <p className="text-gray-400 text-xs mt-1">Be the first to post something about {name}!</p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
          {posts.map(p => (
            <PostRow
              key={p.id} post={p} slug={slug}
              myId={myId} isStaff={isStaff}
              onDelete={onDelete} onReact={onReact}
              onReply={onReply} onDeleteReply={onDeleteReply}
              onPin={onPin}
            />
          ))}
        </div>
      )}

      {posts.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-50 text-center">
          <span className="text-[11px] text-gray-400">{posts.length} post{posts.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}
