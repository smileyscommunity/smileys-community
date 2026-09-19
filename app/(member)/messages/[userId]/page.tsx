'use client'

import { useState, useEffect, useRef, useCallback, use } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_TZ, todayInTz } from '@/lib/cityTime'
import { resolveImageUrl, getInitials } from '@/lib/data'
import { downscaleImage, ImageUploadError } from '@/lib/image-resize'
import { confirmToast } from '@/lib/confirmToast'
import ReportButton from '@/components/ReportButton'
import { toast } from 'sonner'
import { mergeMessages, toggleReactionLocal } from '../messageData'
import { dayKeyOf, daySeparator, messageTime } from '../messageTime'
import { useThreadViewport } from '../useThreadViewport'

interface Reaction { userId: string; emoji: string }

interface ReplySnippet {
  id: string
  // Null (with deleted: true) when the quoted message was deleted — the API
  // withholds its content, so the chip must not fall back to "📷 Photo".
  text: string | null
  imageUrl: string | null
  deleted?: boolean
  from: { id: string; name: string }
}

interface Message {
  id: string
  text: string
  imageUrl: string | null
  replyTo: ReplySnippet | null
  fromId: string
  toId: string
  isRead: boolean
  createdAt: string
  from: { id: string; name: string; color: string; profilePhoto: string | null }
  reactions: Reaction[]
}

interface PartnerInfo {
  id: string; name: string; color: string; profilePhoto: string | null
  lastActive: string | null
  // A connections-only profile the viewer can't see: first name, no photo,
  // and nothing about when they were last around.
  locked: boolean
}

// Why this conversation can't be written to, in the server's own words.
interface Lock { reason: 'blocked' | 'not_connected'; message: string }

const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🙏']
// The server's window: a full page back means there is probably older history.
const PAGE_SIZE = 100
// Poll ticks between full refreshes — 5 × 4s ≈ 20s.
const FULL_REFRESH_EVERY = 5
// lastActive is refreshed every 15 minutes, so anything inside 20 is someone
// who was here since the last refresh. The old 5 minutes called a member who
// was reading right now "Last seen 12m ago".
const ONLINE_WITHIN_MIN = 20
// Roughly the reaction popover's height, for deciding whether it fits below.
const PICKER_HEIGHT = 52
// How near the bottom still counts as "following the conversation".
const NEAR_BOTTOM_PX = 80

function formatLastSeen(lastActive: string | null): string {
  if (!lastActive) return ''
  const diffMs = Date.now() - new Date(lastActive).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < ONLINE_WITHIN_MIN) return 'Online'
  if (diffMin < 60) return `Last seen ${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `Last seen ${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7)    return `Last seen ${diffD}d ago`
  return `Last seen ${new Date(lastActive).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

function Avatar({ user, size = 8 }: { user: { name: string; color: string; profilePhoto: string | null }; size?: number }) {
  const photo = resolveImageUrl(user.profilePhoto)
  // Static class map — Tailwind can't see interpolated names like w-${size};
  // these only rendered because the literals happened to exist elsewhere.
  const s = ({ 7: 'w-7 h-7', 8: 'w-8 h-8', 9: 'w-9 h-9' } as Record<number, string>)[size] ?? 'w-8 h-8'
  return (
    <div className={`${s} rounded-full shrink-0 overflow-hidden flex items-center justify-center text-white text-xs font-bold`}
      style={{ backgroundColor: user.color }}>
      {photo ? <img src={photo} alt={user.name} className="w-full h-full object-cover" /> : getInitials(user.name)}
    </div>
  )
}

export default function ThreadPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId: otherId } = use(params)
  const { user: me } = useAuth()
  const city = useCurrentCity()
  const tz = city?.timezone ?? DEFAULT_TZ
  const [messages,     setMessages]     = useState<Message[]>([])
  const [partner,      setPartner]      = useState<PartnerInfo | null>(null)
  const [text,         setText]         = useState('')
  const [sending,      setSending]      = useState(false)
  const [loading,      setLoading]      = useState(true)
  // Set from the thread's own 403 — the conversation can't be opened at all.
  const [lock,         setLock]         = useState<Lock | null>(null)
  // Set from the GET payload — history stays, writing doesn't (you blocked them).
  const [readOnly,     setReadOnly]     = useState(false)
  const [readOnlyWhy,  setReadOnlyWhy]  = useState<Lock['reason'] | null>(null)
  // Set from a refused send — the draft stays exactly where it is.
  const [sendLock,     setSendLock]     = useState<Lock | null>(null)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [uploading,    setUploading]    = useState(false)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  // Which message has its reaction picker open, and whether it opens upward
  // (decided when it opens, from where the bubble sits in the scroller).
  const [reacting,     setReacting]     = useState<{ id: string; above: boolean } | null>(null)
  // Message being replied to — shows a preview above the input bar until
  // the reply is sent or dismissed.
  const [replyingTo,   setReplyingTo]   = useState<Message | null>(null)
  const [canLoadOlder, setCanLoadOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const paneRef      = useRef<HTMLDivElement>(null)
  const listRef      = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Newest and oldest message on screen: the poll's cursor, and where "load
  // older" continues from. Derived from state rather than set by each fetch,
  // which is how the old cursor ended up null forever on an empty thread.
  const cursorRef    = useRef<string | null>(null)
  const oldestRef    = useRef<string | null>(null)
  const messagesRef  = useRef<Message[]>([])
  const tickRef      = useRef(0)
  const olderDoneRef = useRef(false)
  // Ids this client created, with when. A full refresh that went out before
  // the send landed can't know about them, and must not treat them as deleted.
  const justSentRef  = useRef(new Map<string, number>())
  // True while the reader is at the bottom — read on scroll, because after a
  // message renders the gap is the new message's own height.
  const atBottomRef  = useRef(true)
  const didFirstScrollRef = useRef(false)
  // Distance from the bottom to restore after older history is prepended.
  const keepScrollRef = useRef<number | null>(null)

  const paneHeight = useThreadViewport(paneRef)

  useEffect(() => {
    messagesRef.current = messages
    cursorRef.current = messages.length ? messages[messages.length - 1].createdAt : null
    oldestRef.current = messages.length ? messages[0].createdAt : null
  }, [messages])

  /**
   * One loader for every path. With `since` the server sends only newer rows;
   * without it, it re-sends the newest window — which is the only way an edit
   * (a "Seen" tick, someone's reaction) or a deletion ever reaches the screen.
   */
  const load = useCallback(async (since?: string) => {
    const startedAt = Date.now()
    const url = since
      ? `/app/api/messages/${otherId}?since=${encodeURIComponent(since)}`
      : `/app/api/messages/${otherId}`
    // Polls every 4s — swallow transient network failures so a blip doesn't
    // throw "Failed to fetch" into error tracking; the next tick recovers.
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (res.status === 403) {
        const d = await res.json().catch(() => null)
        setLock({
          reason:  d?.reason === 'blocked' ? 'blocked' : 'not_connected',
          message: typeof d?.error === 'string' && d.error ? d.error : 'You can’t message this person.',
        })
        return
      }
      if (!res.ok) return
      const d = await res.json().catch(() => null)
      // Anything that isn't the documented object is a failed refresh, not an
      // emptied conversation: keep what's on screen.
      if (!d || !Array.isArray(d.messages)) return
      const incoming = d.messages as Message[]
      setLock(null)
      setReadOnly(!!d.readOnly)
      setReadOnlyWhy(d.reason === 'blocked' || d.reason === 'not_connected' ? d.reason : null)
      if (since) {
        setMessages(prev => mergeMessages(prev, incoming))
      } else {
        const keep = [...justSentRef.current].filter(([, at]) => at >= startedAt).map(([id]) => id)
        setMessages(prev => mergeMessages(prev, incoming, { full: true, keep }))
        // Only claim there's older history while we haven't hit the end of it
        // — a full refresh always comes back full once a thread is busy.
        if (!olderDoneRef.current) {
          setCanLoadOlder(typeof d.hasMore === 'boolean' ? d.hasMore : incoming.length >= PAGE_SIZE)
        }
      }
      for (const [id, at] of justSentRef.current) if (at < startedAt) justSentRef.current.delete(id)
    } catch { /* transient — next poll retries */ }
  }, [otherId])

  // Fetch partner info independently so we have it even with no messages,
  // and refresh on a slow interval so the "last seen" stays current.
  useEffect(() => {
    function fetchPartner() {
      // context=dm: opening a chat shouldn't file the reader on the other
      // member's profile-visitors list.
      fetch(`/app/api/members/${otherId}?context=dm`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d?.id) setPartner({
            id: d.id, name: d.name, color: d.color, profilePhoto: d.profilePhoto,
            lastActive: typeof d.lastActive === 'string' ? d.lastActive : null,
            locked: d.viewLevel === 'locked',
          })
        })
        .catch(() => {})
    }
    fetchPartner()
    const t = setInterval(fetchPartner, 60_000)
    return () => clearInterval(t)
  }, [otherId])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  // Poll every 4s. A thread with nothing in it has no cursor, and the old
  // interval only ran when it had one — so on an empty thread the first
  // message the other person sent never appeared until a reload.
  useEffect(() => {
    if (lock) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      tickRef.current += 1
      const since = cursorRef.current
      if (!since || tickRef.current % FULL_REFRESH_EVERY === 0) load()
      else load(since)
    }, 4_000)
    return () => clearInterval(timer)
  }, [load, lock])

  // Coming back to the tab: a full load, because whatever happened while it
  // was hidden includes messages that were read, reacted to or deleted.
  useEffect(() => {
    if (lock) return
    function refresh() { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load, lock])

  // Scrolling belongs to the message list, not the page: jumping an ancestor
  // into view scrolled the whole document, header and all. And it only
  // follows a new message when the reader was already at the bottom —
  // otherwise it yanked them out of the history they were reading.
  useEffect(() => {
    const el = listRef.current
    if (!el || messages.length === 0) return
    if (keepScrollRef.current !== null) {
      el.scrollTop = el.scrollHeight - keepScrollRef.current
      keepScrollRef.current = null
      return
    }
    if (!didFirstScrollRef.current) {
      // Instant on the first paint: animating down through a long thread is a
      // scroll nobody asked for.
      el.scrollTop = el.scrollHeight
      didFirstScrollRef.current = true
      return
    }
    if (atBottomRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  // Grow the composer with what's in it, up to six lines, then let it scroll.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const style = getComputedStyle(el)
    const line = parseFloat(style.lineHeight) || 21
    const max = line * 6 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [text, pendingImage, replyingTo])

  async function loadOlder() {
    const before = oldestRef.current
    if (!before || loadingOlder) return
    setLoadingOlder(true)
    // Keep the message the reader is looking at under their eyes: restore the
    // distance from the bottom once the older page is in.
    keepScrollRef.current = listRef.current
      ? listRef.current.scrollHeight - listRef.current.scrollTop
      : null
    try {
      const res = await fetch(`/app/api/messages/${otherId}?before=${encodeURIComponent(before)}`, { credentials: 'include' })
      const d = res.ok ? await res.json().catch(() => null) : null
      if (!d || !Array.isArray(d.messages)) {
        keepScrollRef.current = null
        toast.error('Couldn’t load older messages — try again')
        return
      }
      const more = typeof d.hasMore === 'boolean' ? d.hasMore : d.messages.length >= PAGE_SIZE
      if (!more) {
        olderDoneRef.current = true
        setCanLoadOlder(false)
      }
      if (d.messages.length === 0) { keepScrollRef.current = null; return }
      setMessages(prev => mergeMessages(prev, d.messages as Message[]))
    } catch {
      keepScrollRef.current = null
      toast.error('Couldn’t load older messages — check your connection')
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if ((!text.trim() && !pendingImage) || sending) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/messages/${otherId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          imageUrl:  pendingImage ?? undefined,
          replyToId: replyingTo?.id ?? undefined,
        }),
      })
      if (res.status === 403) {
        // Every refusal used to read "connect with them first" and swap the
        // composer out, which was wrong for a block and threw away what the
        // member had typed. Say what the server said, and keep the draft.
        const d = await res.json().catch(() => null)
        setSendLock({
          reason:  d?.reason === 'blocked' ? 'blocked' : 'not_connected',
          message: typeof d?.error === 'string' && d.error ? d.error : 'You can’t send messages in this conversation.',
        })
        return
      }
      if (!res.ok) {
        // Surface the reason (rate limit, server error) — a silent return
        // ended the spinner with the text still in the box and no clue why.
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Message not sent — try again')
        return
      }
      const msg = await res.json()
      if (msg?.id) {
        justSentRef.current.set(msg.id, Date.now())
        // Merged, never appended: a poll that returned the same message a
        // moment later used to put a second copy in the thread.
        setMessages(prev => mergeMessages(prev, [msg as Message]))
      }
      setSendLock(null)
      setText('')
      setPendingImage(null)
      setReplyingTo(null)
      atBottomRef.current = true
      textareaRef.current?.focus()
    } catch {
      // Network blip — keep the composed text/image so the user can retry.
      toast.error('Message not sent — check your connection')
    } finally {
      setSending(false)
    }
  }

  async function handleImageChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      // Inside the try: an iCloud-only or unreadable photo throws here, and
      // outside it the attach button stayed locked until a reload.
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'messages')
      const r = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(r => r.json())
      // Upload route returns { url } shaped /app/api/files/<sub>/<file>.ext —
      // server validates with the same regex on send.
      if (r?.url) setPendingImage(r.url)
      else toast.error(r?.error ?? 'Upload failed')
    } catch (err) {
      toast.error(err instanceof ImageUploadError ? err.message : 'Upload failed — try again')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setReacting(null)
    const before = messagesRef.current.find(m => m.id === messageId)?.reactions ?? []
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, reactions: toggleReactionLocal(m.reactions, me?.id, emoji) } : m))
    // Put it back and say so if it didn't stick — this used to fail in total
    // silence, leaving a reaction that existed only on the tapper's screen.
    const rollback = (message: string) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: before } : m))
      toast.error(message)
    }
    try {
      const res = await fetch(`/app/api/messages/${otherId}/react`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, emoji }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(d?.reactions)) {
        rollback(d?.error ?? 'Reaction not saved — try again')
        return
      }
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: d.reactions } : m))
    } catch {
      rollback('Reaction not saved — check your connection')
    }
  }

  function openPicker(e: React.MouseEvent<HTMLButtonElement>, id: string) {
    // Decide the direction from where the bubble sits: opening downward on the
    // newest message put the picker under the bottom edge of the scroller,
    // where it was clipped and unreachable.
    const btn = e.currentTarget.getBoundingClientRect()
    const list = listRef.current?.getBoundingClientRect()
    const above = !!list && btn.bottom + PICKER_HEIGHT > list.bottom
    setReacting(cur => (cur?.id === id ? null : { id, above }))
  }

  // An open picker closes on a tap anywhere else or on Escape; before this it
  // could only be dismissed by picking an emoji.
  useEffect(() => {
    if (!reacting) return
    function onDown(e: PointerEvent) {
      if ((e.target as HTMLElement | null)?.closest('[data-reaction-ui]')) return
      setReacting(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setReacting(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [reacting])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: mid-IME, Enter commits the candidate word. Without this
    // guard, typing Japanese or Korean sent a half-finished message.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(e as unknown as React.FormEvent)
    }
  }

  async function deleteMessage(id: string) {
    if (!(await confirmToast('Delete this message?'))) return
    setDeleting(id)
    try {
      const res = await fetch(`/app/api/messages/${otherId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id }),
      })
      // Only drop it locally if the server actually deleted it, so a failed
      // request doesn't hide a message that's still there on reload.
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== id))
        return
      }
      const d = await res.json().catch(() => null)
      toast.error(d?.error ?? 'Couldn’t delete that message — try again')
    } catch {
      toast.error('Couldn’t delete that message — check your connection')
    } finally {
      setDeleting(null)
    }
  }

  const partnerName = partner?.name ?? 'Member'
  const today = todayInTz(tz)
  // A conversation that closed under the member's fingers keeps its composer
  // while there's an unsent draft in it — the point of holding the draft is
  // that they can still copy it out. Whichever refusal is current explains
  // itself above the box.
  const draft = text.trim().length > 0
  const writeBlock = sendLock ?? (lock && draft ? lock : null)
  const showComposer = !lock || draft

  // Group messages by the city's calendar day, so the separator and the
  // stamps under the messages can't disagree about which day it is.
  const grouped: { key: string; label: string; msgs: Message[] }[] = []
  for (const msg of messages) {
    const key = dayKeyOf(msg.createdAt, tz)
    const last = grouped[grouped.length - 1]
    if (!last || last.key !== key) grouped.push({ key, label: daySeparator(key, today), msgs: [msg] })
    else last.msgs.push(msg)
  }

  return (
    <div className="flex justify-center bg-gray-100">
      {/* Sized to the space that's actually left — see useThreadViewport. The
          list inside scrolls; the header and composer don't move. */}
      <div ref={paneRef} className="flex flex-col bg-white w-full max-w-3xl shadow-sm" style={{ height: paneHeight }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href="/messages" aria-label="Back to messages" className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        {partner && (
          <>
            <Avatar user={partner} size={9} />
            <div className="flex-1 min-w-0">
              <Link href={`/members/${otherId}`} className="font-semibold text-gray-900 hover:underline text-sm block leading-tight">
                {partnerName}
              </Link>
              {(() => {
                // Nothing about a connections-only member's habits, and
                // nothing at all once the conversation is closed: presence is
                // profile information, and they didn't share their profile.
                if (partner.locked || lock) return null
                const status = formatLastSeen(partner.lastActive)
                if (!status) return null
                const online = status === 'Online'
                return (
                  <p className={`text-xs leading-tight mt-0.5 ${online ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
                    {online && <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full mr-1 align-middle" />}
                    {status}
                  </p>
                )
              })()}
            </div>
            {/* Report this conversation partner */}
            <ReportButton reportedId={otherId} reportedName={partnerName} />
          </>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${partnerName}`}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-1"
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : lock ? (
          // A closed conversation says so, instead of inviting the member to
          // "say hi" into a composer that can only be refused.
          <div className="text-center py-16 px-6">
            <p className="text-3xl mb-3" aria-hidden="true">🚫</p>
            <p className="text-sm font-semibold text-gray-700">
              {lock.reason === 'blocked' ? 'You can’t message this person' : 'This conversation isn’t open'}
            </p>
            <p className="text-sm text-gray-500 mt-1">{lock.message}</p>
            <Link href="/messages" className="inline-block mt-4 text-sm text-amber-600 hover:underline font-medium">
              Back to messages
            </Link>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No messages yet. Say hi to {partnerName}!
          </div>
        ) : (
          <>
            {/* The thread only ever holds the newest 100; this walks back
                through the rest a page at a time. */}
            {canLoadOlder && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium px-3 py-1.5 rounded-full border border-amber-200 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                >
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {grouped.map(group => (
            <div key={group.key}>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium whitespace-nowrap">{group.label}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              {group.msgs.map((msg, i) => {
                const isMe = msg.fromId === me?.id
                const prevMsg = group.msgs[i - 1]
                const showAvatar = !isMe && (!prevMsg || prevMsg.fromId !== msg.fromId)
                return (
                  <div key={msg.id} className={`flex gap-2 ${isMe ? 'justify-end' : 'justify-start'} group mb-1`}>
                    {!isMe && (
                      <div className="w-7 shrink-0 flex items-end">
                        {showAvatar && partner && <Avatar user={partner} size={7} />}
                      </div>
                    )}
                    <div className={`max-w-[72%] sm:max-w-[60%] relative`}>
                      {/* Quote bubble — shown above the actual message when
                          it's a reply. SetNull on parent delete means replyTo
                          can be missing even if msg has replyToId; we just
                          don't render the chip in that case. */}
                      {msg.replyTo && (
                        <div className={`mb-1 px-3 py-1.5 rounded-xl text-xs border-l-2 ${
                          isMe
                            ? 'bg-amber-400/40 border-amber-200 text-amber-50'
                            : 'bg-gray-50 border-amber-400 text-gray-600'
                        }`}>
                          <p className={`font-semibold mb-0.5 ${isMe ? 'text-amber-50' : 'text-amber-700'}`}>
                            {msg.replyTo.from.id === me?.id ? 'You' : msg.replyTo.from.name}
                          </p>
                          {msg.replyTo.deleted ? (
                            <p className="truncate italic opacity-80">Message deleted</p>
                          ) : (
                            <p className="truncate">
                              {msg.replyTo.imageUrl && !msg.replyTo.text ? '📷 Photo' : (msg.replyTo.text || '📷 Photo')}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Image attachment — shown above text bubble when present */}
                      {msg.imageUrl && (
                        <a href={resolveImageUrl(msg.imageUrl)} target="_blank" rel="noopener noreferrer"
                          className={`block mb-1 ${isMe ? 'ml-auto' : ''}`}>
                          {/* Someone reading this with the screen off should
                              still be told a photo arrived, and from whom. */}
                          <img src={resolveImageUrl(msg.imageUrl)}
                            alt={isMe ? 'Photo you sent' : `Photo from ${msg.from?.name ?? partnerName}`}
                            className="rounded-2xl max-h-80 w-auto object-cover bg-gray-100" />
                        </a>
                      )}
                      {msg.text && (
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            isMe
                              ? 'bg-amber-500 text-white rounded-br-sm'
                              : 'bg-white text-gray-900 shadow-sm border border-gray-100 rounded-bl-sm'
                          }`}
                        >
                          {msg.text}
                        </div>
                      )}

                      {/* Reactions row — chip per emoji, count if >1, mine highlighted */}
                      {msg.reactions.length > 0 && (
                        <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          {Object.entries(
                            msg.reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
                              const cur = acc[r.emoji] ?? { count: 0, mine: false }
                              cur.count++
                              if (r.userId === me?.id) cur.mine = true
                              acc[r.emoji] = cur
                              return acc
                            }, {})
                          ).map(([emoji, { count, mine }]) => (
                            <button key={emoji}
                              onClick={() => toggleReaction(msg.id, emoji)}
                              aria-pressed={mine}
                              // The chip reads as an emoji and a number; say
                              // what it is out loud.
                              aria-label={`${emoji} reaction, ${count}${mine ? ', including yours' : ''}. ${mine ? 'Remove yours' : 'Add yours'}`}
                              className={`px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                mine
                                  ? 'bg-amber-100 border-amber-300 text-amber-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                              }`}>
                              <span aria-hidden="true">{emoji}{count > 1 && <span className="ml-0.5 font-semibold">{count}</span>}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Meta row — time + read receipts + delete + react button */}
                      <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-xs text-gray-400">{messageTime(msg.createdAt, today, tz)}</span>
                        {isMe && (
                          <span className={`text-xs ${msg.isRead ? 'text-amber-400' : 'text-gray-300'}`} title={msg.isRead ? 'Seen' : 'Sent'}>
                            {msg.isRead ? '✓✓' : '✓'}
                          </span>
                        )}
                        {/* React + Reply + Delete (always visible on mobile via
                            tap; hover-revealed on desktop). Reacting and
                            replying are writes, so a read-only thread doesn't
                            offer them — the server would refuse anyway. */}
                        {!readOnly && (
                          <>
                            <button
                              data-reaction-ui
                              onClick={e => openPicker(e, msg.id)}
                              className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-xs text-gray-400 hover:text-amber-500 transition-all"
                              title="React"
                              aria-label="React"
                            >
                              😀+
                            </button>
                            <button
                              onClick={() => { setReplyingTo(msg); textareaRef.current?.focus() }}
                              className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-xs text-gray-400 hover:text-amber-500 transition-all"
                              title="Reply"
                              aria-label="Reply"
                            >
                              ↩
                            </button>
                          </>
                        )}
                        {isMe && (
                          <button
                            onClick={() => deleteMessage(msg.id)}
                            disabled={deleting === msg.id}
                            // opacity-0 until hover is invisible on a phone
                            // and still takes the tap — a delete nobody could
                            // see, and nobody confirmed.
                            className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-xs text-gray-400 hover:text-red-400 transition-all ml-1"
                            aria-label="Delete message"
                          >
                            {deleting === msg.id ? '…' : 'delete'}
                          </button>
                        )}
                      </div>

                      {/* Reaction picker popover — flipped above the bubble
                          when there's no room under it. */}
                      {reacting?.id === msg.id && (
                        <div
                          data-reaction-ui
                          role="group"
                          aria-label="Add a reaction"
                          className={`absolute z-10 ${reacting.above ? 'bottom-full mb-1' : 'top-full mt-1'} ${isMe ? 'right-0' : 'left-0'} bg-white border border-gray-200 rounded-full shadow-md px-2 py-1.5 flex gap-1`}
                        >
                          {REACTION_EMOJIS.map(e => (
                            <button key={e}
                              onClick={() => toggleReaction(msg.id, e)}
                              className="text-lg hover:scale-125 transition-transform leading-none"
                              aria-label={`React with ${e}`}>
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          </>
        )}
      </div>

      {/* Input — kept clear of the phone's bottom nav and home indicator. A
          blocked conversation has no input bar at all; the state above says
          why. */}
      {showComposer && (
      <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {readOnly ? (
          // The blocker keeps their history and loses the composer: there's
          // nothing to type into a conversation you closed.
          <div className="text-center text-sm text-gray-600 py-1">
            {/* Today the server only marks a thread read-only for the person
                who did the blocking, so that's the sentence unless it says
                otherwise. */}
            {readOnlyWhy === 'not_connected'
              ? `You can read this conversation, but you can’t send messages to ${partnerName}.`
              : 'You blocked this member. You can still read what was said.'}
          </div>
        ) : (
          <div>
            {/* A refused send explains itself here and leaves the draft alone,
                so it can be copied out or retried after connecting. */}
            {writeBlock && (
              <div className="mb-2 text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <p>{writeBlock.message}</p>
                {writeBlock.reason === 'not_connected' && (
                  <Link href={`/members/${otherId}`} className="text-amber-600 hover:underline font-medium">
                    Open {partnerName}&apos;s profile to connect
                  </Link>
                )}
              </div>
            )}

            {/* "Replying to..." preview — sits above the input until sent
                or dismissed. Snippet only; full message stays in the thread. */}
            {replyingTo && (
              <div className="mb-2 flex items-center gap-2 bg-amber-50 border-l-2 border-amber-400 rounded-r-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-700">
                    Replying to {replyingTo.from.id === me?.id ? 'yourself' : replyingTo.from.name}
                  </p>
                  <p className="text-xs text-gray-600 truncate">
                    {replyingTo.imageUrl && !replyingTo.text ? '📷 Photo' : (replyingTo.text || '📷 Photo')}
                  </p>
                </div>
                <button onClick={() => setReplyingTo(null)}
                  className="w-6 h-6 text-gray-400 hover:text-gray-700 text-lg leading-none shrink-0">×</button>
              </div>
            )}

            {/* Pending image preview — small thumbnail above the input bar with
                a × to remove before sending. */}
            {pendingImage && (
              <div className="mb-2 inline-block relative">
                <img src={resolveImageUrl(pendingImage)} alt="Photo ready to send" className="max-h-32 rounded-xl border border-gray-200" />
                <button onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-gray-900 text-white rounded-full text-xs font-bold flex items-center justify-center hover:bg-gray-700">×</button>
              </div>
            )}
            <form onSubmit={send} className="flex items-end gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChoose} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending || !!writeBlock}
                className="p-2.5 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors shrink-0 disabled:opacity-40"
                title="Attach photo"
                aria-label="Attach photo"
              >
                {uploading ? (
                  <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                )}
              </button>
              <label htmlFor="dm-composer" className="sr-only">Message {partnerName}</label>
              <textarea
                id="dm-composer"
                ref={textareaRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pendingImage ? 'Add a caption (optional)…' : `Message ${partnerName}…`}
                rows={1}
                maxLength={2000}
                // readOnly rather than disabled once a send was refused: the
                // draft stays selectable, so it can be copied somewhere else.
                readOnly={!!writeBlock}
                aria-disabled={!!writeBlock}
                className={`flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none ${writeBlock ? 'bg-gray-50 text-gray-500' : ''}`}
                style={{ lineHeight: '1.5' }}
              />
              <button
                type="submit"
                aria-label="Send message"
                disabled={(!text.trim() && !pendingImage) || sending || !!writeBlock}
                className="p-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl transition-colors shrink-0"
              >
                <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>
      )}
      </div>
    </div>
  )
}
