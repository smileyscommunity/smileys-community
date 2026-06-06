'use client'

import { useState, useEffect, useRef } from 'react'
import { resolveImageUrl, getInitials } from '@/lib/data'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PostAuthor {
  id: string; name: string; color: string; photo: string | null; role: string; clubRole: string | null
}
interface Reaction  { emoji: string; count: number; reactedByMe: boolean }
interface PollOption { id: string; text: string; voteCount: number; votedByMe: boolean }
interface Poll {
  id: string; question: string; totalVotes: number; myVoteOptionId: string | null; options: PollOption[]
}
interface Reply { id: string; content: string; createdAt: string; author: PostAuthor }
interface Post {
  id: string; content: string; createdAt: string; isPinned: boolean
  author: PostAuthor; reactions: Reaction[]; poll: Poll | null; replies: Reply[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REACTIONS = ['❤️', '👍', '🔥', '😂']
const PREVIEW_COUNT = 2

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderContent(text: string) {
  const parts = text.split(/(@\w+)/g)
  return parts.map((part, i) =>
    /^@\w+$/.test(part)
      ? <span key={i} className="font-semibold text-amber-600">{part}</span>
      : <span key={i}>{part}</span>
  )
}

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Avatar({ author, size = 'md' }: { author: PostAuthor; size?: 'sm' | 'md' }) {
  const photo = resolveImageUrl(author.photo)
  const cls   = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-xs'
  return photo ? (
    <img src={photo} alt={author.name} loading="lazy" className={`${cls} rounded-full object-cover shrink-0`} />
  ) : (
    <div className={`${cls} rounded-full flex items-center justify-center text-white font-bold shrink-0`} style={{ backgroundColor: author.color }}>
      {getInitials(author.name)}
    </div>
  )
}

function AuthorBadge({ role, clubRole }: { role: string; clubRole: string | null }) {
  if (clubRole === 'host' || role === 'host') {
    return <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Host</span>
  }
  if (role === 'admin' || role === 'moderator') {
    return <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Staff</span>
  }
  return null
}

function PollBlock({
  poll, postId, slug, canVote,
  onVote,
}: {
  poll: Poll; postId: string; slug: string; canVote: boolean
  onVote: (postId: string, update: { myVoteOptionId: string | null; totalVotes: number; options: { id: string; voteCount: number; votedByMe: boolean }[] }) => void
}) {
  const [voting, setVoting] = useState(false)

  async function vote(optionId: string) {
    if (!canVote || voting) return
    setVoting(true)
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}/poll`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    })
    if (res.ok) {
      const data = await res.json()
      onVote(postId, data)
    }
    setVoting(false)
  }

  return (
    <div className="mt-3 bg-gray-50 rounded-xl p-3">
      <p className="text-sm font-semibold text-gray-900 mb-2.5">{poll.question}</p>
      <div className="space-y-2">
        {poll.options.map(opt => {
          const pct = poll.totalVotes > 0 ? Math.round(opt.voteCount / poll.totalVotes * 100) : 0
          const isMyVote = poll.myVoteOptionId === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => vote(opt.id)}
              disabled={!canVote || voting}
              className={`w-full text-left relative rounded-lg overflow-hidden border transition-all ${
                isMyVote
                  ? 'border-amber-400'
                  : canVote ? 'border-gray-200 hover:border-amber-300' : 'border-gray-200'
              } ${!canVote ? 'cursor-default' : ''}`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-500 ${isMyVote ? 'bg-amber-100' : 'bg-gray-100'}`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between px-3 py-2">
                <span className="text-sm text-gray-800 flex items-center gap-1.5">
                  {isMyVote && <span className="text-amber-500">✓</span>}
                  {opt.text}
                </span>
                <span className="text-xs text-gray-500 font-medium shrink-0 ml-2">{pct}%</span>
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2">{poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'}</p>
    </div>
  )
}

function ReplyForm({ slug, postId, onReply, onCancel }: {
  slug: string; postId: string
  onReply: (reply: Reply) => void; onCancel: () => void
}) {
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit() {
    if (!text.trim() || sending) return
    setSending(true); setError('')
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}/replies`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.trim() }),
    })
    if (res.ok) { onReply(await res.json()); setText('') }
    else { const d = await res.json(); setError(d.error ?? 'Failed') }
    setSending(false)
  }

  return (
    <div className="mt-2 ml-10">
      <div className="flex gap-2 items-center">
        <input ref={inputRef} type="text" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
          placeholder="Write a reply… (Enter to post, Esc to cancel)"
          maxLength={1000}
          className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 text-gray-900 placeholder-gray-400"
        />
        <button onClick={submit} disabled={!text.trim() || sending}
          className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl disabled:opacity-40 transition-colors shrink-0">
          {sending ? '…' : 'Reply'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1 ml-1">{error}</p>}
    </div>
  )
}

// ─── Poll Composer ────────────────────────────────────────────────────────────

function PollComposer({ onChange }: {
  onChange: (poll: { question: string; options: string[] } | null) => void
}) {
  const [question, setQuestion] = useState('')
  const [options,  setOptions]  = useState(['', ''])

  function update(q: string, opts: string[]) {
    setQuestion(q); setOptions(opts)
    const validOpts = opts.map(o => o.trim()).filter(Boolean)
    onChange(q.trim() && validOpts.length >= 2 ? { question: q.trim(), options: opts } : null)
  }

  function setOpt(i: number, val: string) {
    const next = [...options]; next[i] = val; update(question, next)
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
      <input value={question} onChange={e => update(e.target.value, options)}
        placeholder="Ask a question…"
        className="w-full text-sm px-3 py-2 border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50/50 text-gray-800 placeholder-gray-400"
      />
      {options.map((opt, i) => (
        <div key={i} className="flex gap-2">
          <input value={opt} onChange={e => setOpt(i, e.target.value)}
            placeholder={`Option ${i + 1}`}
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 text-gray-800 placeholder-gray-400"
          />
          {options.length > 2 && (
            <button onClick={() => { const next = options.filter((_, j) => j !== i); update(question, next) }}
              className="text-gray-300 hover:text-red-400 text-xl leading-none px-1">×</button>
          )}
        </div>
      ))}
      {options.length < 6 && (
        <button onClick={() => update(question, [...options, ''])}
          className="text-xs text-amber-600 hover:text-amber-700 font-semibold">
          + Add option
        </button>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  slug: string; canPost: boolean; currentUserId?: string; isAdmin?: boolean; canPin?: boolean
  // Gate for the "📊 Poll" composer toggle. Polls are organizational
  // (decide a venue, gauge interest) — admins/mods/hosts only. When
  // false the toggle is hidden but the user can still post text and
  // vote on whatever polls already exist in the stream.
  canAnnounce?: boolean
}

export default function ClubWall({ slug, canPost, currentUserId, isAdmin, canPin, canAnnounce }: Props) {
  const [posts,          setPosts]          = useState<Post[]>([])
  const [loading,        setLoading]        = useState(true)
  const [content,        setContent]        = useState('')
  const [posting,        setPosting]        = useState(false)
  const [error,          setError]          = useState('')
  const [pollMode,       setPollMode]       = useState(false)
  const [pendingPoll,    setPendingPoll]    = useState<{ question: string; options: string[] } | null>(null)
  const [replyingTo,     setReplyingTo]     = useState<string | null>(null)
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/posts`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setPosts(data) })
      .finally(() => setLoading(false))
  }, [slug])

  async function submit() {
    if ((!content.trim() && !pendingPoll) || posting) return
    if (pollMode && !pendingPoll) { setError('Fill in the poll question and at least 2 options'); return }
    setPosting(true); setError('')
    const res = await fetch(`/app/api/clubs/${slug}/posts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ...(pollMode && pendingPoll ? { poll: pendingPoll } : {}) }),
    })
    if (res.ok) {
      const post = await res.json()
      setPosts(prev => [post, ...prev])
      setContent(''); setPollMode(false); setPendingPoll(null)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to post')
    }
    setPosting(false)
  }

  async function toggleReaction(postId: string, emoji: string) {
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}/like`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    })
    if (res.ok) {
      const { reactions } = await res.json()
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, reactions } : p))
    }
  }

  async function togglePin(postId: string, current: boolean) {
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPinned: !current }),
    })
    if (res.ok) {
      setPosts(prev => {
        const updated = prev.map(p => p.id === postId ? { ...p, isPinned: !current } : p)
        return [...updated.filter(p => p.isPinned), ...updated.filter(p => !p.isPinned)]
      })
    }
  }

  async function deletePost(postId: string) {
    if (!confirm('Delete this post?')) return
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setPosts(prev => prev.filter(p => p.id !== postId))
  }

  async function deleteReply(postId: string, replyId: string) {
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}/replies/${replyId}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setPosts(prev => prev.map(p => p.id === postId ? { ...p, replies: p.replies.filter(r => r.id !== replyId) } : p))
  }

  function handlePollVote(postId: string, update: { myVoteOptionId: string | null; totalVotes: number; options: { id: string; voteCount: number; votedByMe: boolean }[] }) {
    setPosts(prev => prev.map(p => {
      if (p.id !== postId || !p.poll) return p
      return {
        ...p,
        poll: {
          ...p.poll,
          myVoteOptionId: update.myVoteOptionId,
          totalVotes:     update.totalVotes,
          options: p.poll.options.map(o => {
            const u = update.options.find(uo => uo.id === o.id)
            return u ? { ...o, voteCount: u.voteCount, votedByMe: u.votedByMe } : o
          }),
        },
      }
    }))
  }

  function handleNewReply(postId: string, reply: Reply) {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, replies: [...p.replies, reply] } : p))
    setReplyingTo(null)
    setExpandedReplies(prev => new Set(prev).add(postId))
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }

  return (
    <div className="space-y-5">
      {/* ── Composer (text post + optional poll, polls admin/host only) ── */}
      {canPost ? (
        <div className="bg-white rounded-2xl shadow-card p-4">
          <textarea ref={textareaRef} value={content} onChange={autoResize}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
            placeholder={pollMode ? 'Add context to your poll (optional)…' : 'Share something with the club…'}
            rows={3}
            className="w-full text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none leading-relaxed"
            style={{ minHeight: 72 }}
          />

          {pollMode && <PollComposer onChange={setPendingPoll} />}
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <span className={`text-xs ${content.length > 1800 ? 'text-red-500' : 'text-gray-400'}`}>{content.length} / 2000</span>
              {/* Poll toggle — hidden from regular members. canAnnounce
                  matches the admin/mod/host audience that can pin
                  announcements; same authority bar for poll creation.
                  Server gate in /api/clubs/[slug]/posts is the
                  enforcement layer. */}
              {canAnnounce && (
                <button
                  onClick={() => { setPollMode(v => !v); setPendingPoll(null) }}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    pollMode
                      ? 'bg-amber-100 text-amber-700 border-amber-300'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50'
                  }`}
                >
                  📊 Poll
                </button>
              )}
            </div>
            <button onClick={submit}
              disabled={(!content.trim() && !pendingPoll) || posting || content.length > 2000}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40">
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-700 text-center">
          Join this club to post on the wall.
        </div>
      )}

      {/* ── Posts ── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl shadow-card p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-1/4" />
                  <div className="h-3 bg-gray-200 rounded w-full" />
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <span className="text-4xl block mb-3">💬</span>
          <p className="text-gray-500 text-sm">No posts yet. Be the first to share something!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map(post => {
            const canDelete      = currentUserId === post.author.id || isAdmin
            const isExpanded     = expandedReplies.has(post.id)
            const visibleReplies = isExpanded ? post.replies : post.replies.slice(-PREVIEW_COUNT)
            const hiddenCount    = post.replies.length - PREVIEW_COUNT

            return (
              <div key={post.id} className={`bg-white rounded-2xl shadow-card p-4 ${post.isPinned ? 'ring-1 ring-amber-200' : ''}`}>

                {/* Pinned label */}
                {post.isPinned && (
                  <div className="flex items-center gap-1 text-xs font-semibold text-amber-600 mb-2">
                    <span>📌</span> Pinned
                  </div>
                )}

                <div className="flex gap-3">
                  <Avatar author={post.author} />
                  <div className="flex-1 min-w-0">
                    {/* Author row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{post.author.name}</span>
                      <AuthorBadge role={post.author.role} clubRole={post.author.clubRole} />
                      <span className="text-xs text-gray-400">{formatRelative(post.createdAt)}</span>
                    </div>

                    {/* Content */}
                    {post.content && (
                      <p className="text-sm text-gray-700 mt-1.5 leading-relaxed whitespace-pre-wrap break-words">{renderContent(post.content)}</p>
                    )}

                    {/* Poll */}
                    {post.poll && (
                      <PollBlock
                        poll={post.poll} postId={post.id} slug={slug} canVote={!!currentUserId}
                        onVote={handlePollVote}
                      />
                    )}

                    {/* Reactions */}
                    <div className="flex items-center gap-1 mt-3 flex-wrap">
                      {REACTIONS.map(emoji => {
                        const r       = post.reactions.find(rx => rx.emoji === emoji)
                        const active  = r?.reactedByMe ?? false
                        return (
                          <button
                            key={emoji}
                            onClick={() => currentUserId ? toggleReaction(post.id, emoji) : undefined}
                            className={`flex items-center gap-1 text-sm px-2 py-1 rounded-lg transition-colors ${
                              active
                                ? 'bg-amber-50 ring-1 ring-amber-300 font-semibold'
                                : currentUserId ? 'hover:bg-gray-50 text-gray-400' : 'text-gray-300 cursor-default'
                            }`}
                          >
                            {emoji}
                            {r && r.count > 0 && <span className={`text-xs ${active ? 'text-amber-700' : 'text-gray-500'}`}>{r.count}</span>}
                          </button>
                        )
                      })}

                      {/* Reply button */}
                      {canPost && (
                        <button onClick={() => setReplyingTo(replyingTo === post.id ? null : post.id)}
                          className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-amber-500 transition-colors ml-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          Reply{post.replies.length > 0 && ` (${post.replies.length})`}
                        </button>
                      )}

                      {/* Pin / delete */}
                      <div className="ml-auto flex items-center gap-2">
                        {canPin && (
                          <button onClick={() => togglePin(post.id, post.isPinned)}
                            title={post.isPinned ? 'Unpin' : 'Pin to top'}
                            className={`text-base transition-colors ${post.isPinned ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}>
                            📌
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => deletePost(post.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Replies */}
                {post.replies.length > 0 && (
                  <div className="mt-3 ml-12 space-y-2.5 border-l-2 border-gray-100 pl-3">
                    {!isExpanded && hiddenCount > 0 && (
                      <button onClick={() => setExpandedReplies(prev => new Set(prev).add(post.id))}
                        className="text-xs text-amber-600 hover:text-amber-700 font-semibold">
                        Show {hiddenCount} earlier {hiddenCount === 1 ? 'reply' : 'replies'}
                      </button>
                    )}
                    {visibleReplies.map(reply => {
                      const canDelReply = currentUserId === reply.author.id || isAdmin
                      return (
                        <div key={reply.id} className="flex gap-2 group">
                          <Avatar author={reply.author} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-gray-900">{reply.author.name}</span>
                              <AuthorBadge role={reply.author.role} clubRole={reply.author.clubRole} />
                              <span className="text-xs text-gray-400">{formatRelative(reply.createdAt)}</span>
                            </div>
                            <p className="text-xs text-gray-700 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">{renderContent(reply.content)}</p>
                          </div>
                          {canDelReply && (
                            <button onClick={() => deleteReply(post.id, reply.id)}
                              className="text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-base leading-none shrink-0 self-start mt-0.5">
                              ×
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {isExpanded && post.replies.length > PREVIEW_COUNT && (
                      <button onClick={() => setExpandedReplies(prev => { const s = new Set(prev); s.delete(post.id); return s })}
                        className="text-xs text-gray-400 hover:text-gray-600">Show less</button>
                    )}
                  </div>
                )}

                {/* Reply composer */}
                {replyingTo === post.id && (
                  <ReplyForm slug={slug} postId={post.id}
                    onReply={reply => handleNewReply(post.id, reply)}
                    onCancel={() => setReplyingTo(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
