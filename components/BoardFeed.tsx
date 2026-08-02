'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import AvatarImg from '@/components/AvatarImg'
import { avatarUrl, ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { BOARD_POST_TYPES, PLAN_TAGS, QUESTION_TAGS, PLAN_WHEN, TAG_LABEL, type BoardPostType } from '@/lib/board'

interface PostUser { id: string; name: string; color: string; profilePhoto: string | null }
interface Post {
  id: string; type: BoardPostType; title: string; body: string
  neighborhood: string | null; tag: string | null; whenLabel: string | null
  pinned: boolean; createdAt: string; user: PostUser
  replyCount: number; interestCount: number; saveCount: number
  viewerInterested: boolean; viewerSaved: boolean
}
interface Reply { id: string; body: string; parentId: string | null; createdAt: string; user: PostUser }
interface Visitor { id: string; name: string; fromCity: string | null; startsOn: string; neighborhood: string | null }

const TYPE_META = Object.fromEntries(BOARD_POST_TYPES.map(t => [t.value, t]))

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function fmtArrival(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function VisitorsModule({ visitors }: { visitors: Visitor[] }) {
  if (visitors.length === 0) return null
  return (
    <div className="bg-sky-50 border border-sky-100 rounded-2xl p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-sky-700 mb-3">✈️ Coming to Istanbul</p>
      <div className="space-y-2">
        {visitors.map(v => (
          <p key={v.id} className="text-sm text-gray-700">
            <span className="font-bold text-gray-900">{v.name.split(' ')[0]}</span>
            {v.fromCity && <> · {v.fromCity}</>}
            {v.neighborhood && <> · 📍 {v.neighborhood}</>}
            <> · arriving {fmtArrival(v.startsOn)}</>
          </p>
        ))}
      </div>
      <Link href="/visiting" className="inline-block mt-3 text-xs font-bold text-sky-700 hover:underline">
        Welcome someone →
      </Link>
    </div>
  )
}

// ── Composer ────────────────────────────────────────────────────────────────
function Composer({ onPosted }: { onPosted: () => void }) {
  const { user, isLoggedIn } = useAuth()
  const [open,         setOpen]         = useState(false)
  const [type,         setType]         = useState<BoardPostType>('plan')
  const [title,        setTitle]        = useState('')
  const [body,         setBody]         = useState('')
  const [tag,          setTag]          = useState('')
  const [whenLabel,    setWhenLabel]    = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [posting,      setPosting]      = useState(false)

  const PLACEHOLDER: Record<BoardPostType, string> = {
    plan:     'Anyone around for coffee in Moda this afternoon?',
    question: 'What would you like help with?',
    reco:     'Found a great quiet café for working in Kadıköy…',
    share:    'Share something useful with the community',
  }

  if (!isLoggedIn) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm mb-6 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-600">Ask a question, make a plan, or share something useful.</p>
        <Link href="/apply" className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
          Join Smileys to post
        </Link>
      </div>
    )
  }

  async function submit() {
    if (posting) return
    if (!title.trim()) { toast.error('Say what your post is about'); return }
    setPosting(true)
    try {
      const res = await fetch('/app/api/board', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, title, body,
          tag: tag || undefined,
          whenLabel: whenLabel || undefined,
          neighborhood: neighborhood || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Posted!')
      setTitle(''); setBody(''); setTag(''); setWhenLabel(''); setOpen(false)
      onPosted()
    } finally {
      setPosting(false)
    }
  }

  const tagChips = type === 'plan' ? PLAN_TAGS : type === 'question' ? QUESTION_TAGS : []

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm mb-6">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full flex items-center gap-3 text-left group">
          <AvatarImg src={avatarUrl(user.profilePhoto ?? null, 64)} name={user.name ?? '?'} color={user.color ?? '#f59e0b'}
            size="w-10 h-10" textSize="text-sm" className="shrink-0" />
          <span className="flex-1 px-4 py-2.5 rounded-full bg-gray-50 border border-gray-200 text-sm text-gray-400 group-hover:border-amber-300 transition-colors">
            What&apos;s happening?
          </span>
        </button>
      ) : (
        <div>
          <div className="flex gap-2 flex-wrap mb-4">
            {BOARD_POST_TYPES.map(t => (
              <button key={t.value} onClick={() => { setType(t.value); setTag(''); setWhenLabel('') }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  type === t.value ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                }`}>
                {t.emoji} {t.value === 'plan' ? 'Make a Plan' : t.value === 'question' ? 'Ask' : t.value === 'reco' ? 'Recommend' : 'Share'}
              </button>
            ))}
          </div>

          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} autoFocus
            placeholder={PLACEHOLDER[type]}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold mb-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={1000} rows={2}
            placeholder="Add a few details (optional)"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />

          {tagChips.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-3">
              {tagChips.map(t => (
                <button key={t.value} onClick={() => setTag(tag === t.value ? '' : t.value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    tag === t.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
                  }`}>
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          )}

          {type === 'plan' && (
            <div className="flex gap-1.5 flex-wrap mb-3">
              {PLAN_WHEN.map(w => (
                <button key={w} onClick={() => setWhenLabel(whenLabel === w ? '' : w)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    whenLabel === w ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-gray-600 border-gray-200'
                  }`}>
                  {w}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none">
              <option value="">📍 Neighborhood (optional)</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 transition-colors">
                Cancel
              </button>
              <button onClick={submit} disabled={posting || !title.trim()}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors">
                {posting ? 'Posting…' : type === 'plan' ? 'Post Plan →' : type === 'question' ? 'Ask the Community →' : type === 'reco' ? 'Share Recommendation →' : 'Post →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Replies ─────────────────────────────────────────────────────────────────
function RepliesBlock({ postId, onCount }: { postId: string; onCount: (n: number) => void }) {
  const { isLoggedIn } = useAuth()
  const [replies, setReplies] = useState<Reply[] | null>(null)
  const [text,    setText]    = useState('')
  const [replyTo, setReplyTo] = useState<Reply | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/app/api/board/${postId}/replies`, { credentials: 'include' })
    const data = await res.json().catch(() => ({ replies: [] }))
    setReplies(data.replies ?? [])
  }, [postId])

  useEffect(() => { load() }, [load])

  async function send() {
    if (sending || !text.trim()) return
    if (!isLoggedIn) { toast.error('Join Smileys to reply'); return }
    setSending(true)
    try {
      const res = await fetch(`/app/api/board/${postId}/replies`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, parentId: replyTo?.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not reply'); return }
      setText(''); setReplyTo(null)
      await load()
      onCount((replies?.length ?? 0) + 1)
    } finally {
      setSending(false)
    }
  }

  if (replies === null) return <p className="text-xs text-gray-400 py-3">Loading replies…</p>

  const top = replies.filter(r => !r.parentId)
  const childrenOf = (id: string) => replies.filter(r => r.parentId === id)

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      {top.map(r => (
        <div key={r.id}>
          <div className="flex items-start gap-2.5">
            <AvatarImg src={avatarUrl(r.user.profilePhoto, 64)} name={r.user.name} color={r.user.color}
              size="w-7 h-7" textSize="text-[10px]" className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs">
                <Link href={`/members/${r.user.id}`} className="font-bold text-gray-900 hover:text-amber-600">{r.user.name.split(' ')[0]}</Link>
                <span className="text-gray-400 ml-1.5">{timeAgo(r.createdAt)}</span>
              </p>
              <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{r.body}</p>
              {isLoggedIn && (
                <button onClick={() => setReplyTo(r)} className="text-[11px] font-semibold text-gray-400 hover:text-amber-600 mt-0.5">
                  Reply
                </button>
              )}
              {childrenOf(r.id).map(c => (
                <div key={c.id} className="flex items-start gap-2 mt-2 ml-1 pl-3 border-l-2 border-gray-100">
                  <AvatarImg src={avatarUrl(c.user.profilePhoto, 64)} name={c.user.name} color={c.user.color}
                    size="w-6 h-6" textSize="text-[9px]" className="shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs">
                      <Link href={`/members/${c.user.id}`} className="font-bold text-gray-900 hover:text-amber-600">{c.user.name.split(' ')[0]}</Link>
                      <span className="text-gray-400 ml-1.5">{timeAgo(c.createdAt)}</span>
                    </p>
                    <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {isLoggedIn ? (
        <div>
          {replyTo && (
            <p className="text-[11px] text-gray-500 mb-1">
              Replying to <span className="font-semibold">{replyTo.user.name.split(' ')[0]}</span>
              <button onClick={() => setReplyTo(null)} className="ml-2 text-gray-400 hover:text-gray-600">✕</button>
            </p>
          )}
          <div className="flex gap-2">
            <input value={text} onChange={e => setText(e.target.value)} maxLength={500}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Write a reply…"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <button onClick={send} disabled={sending || !text.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors">
              {sending ? '…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <Link href="/apply" className="inline-block text-xs font-bold text-amber-600 hover:underline">
          Join Smileys to reply →
        </Link>
      )}
    </div>
  )
}

// ── Post card ───────────────────────────────────────────────────────────────
function PostCard({ p, onRemoved }: { p: Post; onRemoved: (id: string) => void }) {
  const { user, isLoggedIn } = useAuth()
  const meta = TYPE_META[p.type]
  const [showReplies, setShowReplies] = useState(false)
  const [replyCount,  setReplyCount]  = useState(p.replyCount)
  const [interested,  setInterested]  = useState(p.viewerInterested)
  const [interestN,   setInterestN]   = useState(p.interestCount)
  const [saved,       setSaved]       = useState(p.viewerSaved)
  const [menuOpen,    setMenuOpen]    = useState(false)
  const isOwn = isLoggedIn && user.id === p.user.id

  async function react(kind: 'interest' | 'save') {
    if (!isLoggedIn) { toast.error('Join Smileys to continue'); return }
    const res = await fetch(`/app/api/board/${p.id}/react`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error ?? 'Something went wrong'); return }
    if (kind === 'interest') { setInterested(data.active); setInterestN(n => n + (data.active ? 1 : -1)) }
    else setSaved(data.active)
  }

  async function report(reason: string) {
    setMenuOpen(false)
    const res = await fetch(`/app/api/board/${p.id}/report`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error ?? 'Could not report'); return }
    toast.success('Reported — our moderators will take a look')
  }

  async function remove() {
    setMenuOpen(false)
    const res = await fetch(`/app/api/board/${p.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { toast.error('Could not delete'); return }
    toast.success('Post removed')
    onRemoved(p.id)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Link href={`/members/${p.user.id}`}>
          <AvatarImg src={avatarUrl(p.user.profilePhoto, 96)} name={p.user.name} color={p.user.color}
            size="w-11 h-11" textSize="text-sm" className="shrink-0" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/members/${p.user.id}`} className="text-sm font-bold text-gray-900 hover:text-amber-600">
              {p.user.name}
            </Link>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.badgeCls}`}>
              {meta.emoji} {meta.label}
            </span>
            {p.pinned && <span className="text-[10px] font-bold text-gray-500">📌 Pinned</span>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {p.neighborhood && <><span aria-hidden="true">📍 </span>{p.neighborhood} · </>}
            {timeAgo(p.createdAt)}
          </p>
        </div>
        {isLoggedIn && (
          <div className="relative shrink-0">
            <button onClick={() => setMenuOpen(v => !v)} aria-label="Post options"
              className="text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-50">•••</button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-10 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44">
                {isOwn ? (
                  <button onClick={remove} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Delete post</button>
                ) : (
                  <>
                    <button onClick={() => report('spam')} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Report as spam</button>
                    <button onClick={() => report('inappropriate')} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Report as inappropriate</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <h3 className="font-bold text-gray-900 mt-3 leading-snug">{p.title}</h3>
      {p.body && <p className="text-sm text-gray-700 mt-1.5 leading-relaxed whitespace-pre-wrap">{p.body}</p>}

      {(p.tag || p.whenLabel) && (
        <div className="flex gap-1.5 flex-wrap mt-2.5">
          {p.tag && TAG_LABEL[p.tag] && (
            <span className="text-[11px] font-semibold bg-gray-50 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">
              {TAG_LABEL[p.tag].emoji} {TAG_LABEL[p.tag].label}
            </span>
          )}
          {p.whenLabel && (
            <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">
              🕐 {p.whenLabel}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        {p.type === 'plan' && !isOwn && (
          <button onClick={() => react('interest')}
            className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
              interested ? 'bg-green-100 text-green-800 border-green-200' : 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
            }`}>
            {interested ? '✓ Interested' : "👋 I'm interested"}{interestN > 0 && ` · ${interestN}`}
          </button>
        )}
        {p.type === 'plan' && isOwn && interestN > 0 && (
          <span className="text-xs font-bold text-green-700 bg-green-50 px-3 py-1.5 rounded-full">
            👋 {interestN} interested
          </span>
        )}
        {p.type === 'reco' && !isOwn && (
          <button onClick={() => react('save')}
            className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
              saved ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-gray-700 border-gray-200 hover:border-red-200'
            }`}>
            {saved ? '❤️ Saved' : '🤍 Save'}
          </button>
        )}
        <button onClick={() => setShowReplies(v => !v)}
          className="text-xs font-bold px-3 py-1.5 rounded-full border bg-white text-gray-700 border-gray-200 hover:border-amber-300 transition-colors">
          💬 {replyCount > 0 ? `${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}` : 'Reply'}
        </button>
      </div>

      {showReplies && <RepliesBlock postId={p.id} onCount={setReplyCount} />}
    </div>
  )
}

// ── Feed ────────────────────────────────────────────────────────────────────
const FEED_CHIPS = [
  { id: '',         label: 'Latest' },
  { id: 'plan',     label: '☕ Plans' },
  { id: 'question', label: '❓ Questions' },
  { id: 'reco',     label: '💡 Recommendations' },
  { id: 'share',    label: '📣 Community' },
]

export default function BoardFeed() {
  const [posts,    setPosts]    = useState<Post[]>([])
  const [filter,   setFilter]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [hasMore,  setHasMore]  = useState(false)
  const [visitors, setVisitors] = useState<Visitor[]>([])

  // Visiting Istanbul module — same records as /visiting (the API already
  // handles member-only visibility and contact redaction). Fetched once;
  // the module renders only when there are real upcoming visitors.
  useEffect(() => {
    fetch('/app/api/visitors', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setVisitors((d.announcements ?? []).slice(0, 3).map((a: { id: string; name: string; fromCity: string | null; startsOn: string; neighborhood: string | null }) =>
        ({ id: a.id, name: a.name, fromCity: a.fromCity, startsOn: a.startsOn, neighborhood: a.neighborhood }))))
      .catch(() => {})
  }, [])

  const load = useCallback(async (type: string, offset: number, append: boolean) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      if (offset) params.set('offset', String(offset))
      const res = await fetch(`/app/api/board?${params}`, { credentials: 'include' })
      const data = await res.json().catch(() => ({ posts: [] }))
      const next: Post[] = data.posts ?? []
      setPosts(prev => append ? [...prev, ...next] : next)
      setHasMore(next.length === 15)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filter, 0, false) }, [filter, load])

  return (
    <div className="max-w-2xl">
      <Composer onPosted={() => load(filter, 0, false)} />

      <div className="flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide">
        {FEED_CHIPS.map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap transition-colors ${
              filter === c.id ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      {loading && posts.length === 0 ? (
        /* Skeletons, not a spinner */
        <div className="space-y-4 mt-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse">
              <div className="flex items-center gap-3"><div className="w-11 h-11 rounded-full bg-gray-100" /><div className="h-3 bg-gray-100 rounded w-32" /></div>
              <div className="h-4 bg-gray-100 rounded w-3/4 mt-4" />
              <div className="h-3 bg-gray-100 rounded w-1/2 mt-2" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        /* Actionable empty state — never a bare "no posts". The visitors
           module still renders under it: a quiet feed showing real people
           arriving is the opposite of a dead page. */
        <div>
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center mt-3">
            <div aria-hidden="true" className="text-4xl mb-3">🌱</div>
            <p className="font-bold text-gray-900">It&apos;s quiet right now. Start something.</p>
            <p className="text-sm text-gray-600 mt-1">
              Make a coffee plan, ask your neighborhood a question, or share a local favorite.
            </p>
          </div>
          <div className="mt-4"><VisitorsModule visitors={visitors} /></div>
        </div>
      ) : (
        <div className="space-y-4 mt-3">
          {posts.slice(0, 3).map(p => (
            <PostCard key={p.id} p={p} onRemoved={id => setPosts(prev => prev.filter(x => x.id !== id))} />
          ))}
          <VisitorsModule visitors={visitors} />
          {posts.slice(3).map(p => (
            <PostCard key={p.id} p={p} onRemoved={id => setPosts(prev => prev.filter(x => x.id !== id))} />
          ))}
          {hasMore && (
            <button onClick={() => load(filter, posts.length, true)} disabled={loading}
              className="w-full py-3 border border-gray-200 rounded-2xl text-sm font-bold text-gray-700 hover:border-amber-300 hover:text-amber-700 bg-white transition-colors">
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
