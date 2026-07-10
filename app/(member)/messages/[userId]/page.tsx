'use client'

import { useState, useEffect, useRef, useCallback, use } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl, getInitials } from '@/lib/data'
import { downscaleImage } from '@/lib/image-resize'

interface Reaction { userId: string; emoji: string }

interface ReplySnippet {
  id: string
  text: string
  imageUrl: string | null
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
}

const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🙏']

function formatLastSeen(lastActive: string | null): string {
  if (!lastActive) return ''
  const diffMs = Date.now() - new Date(lastActive).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 5)  return 'Online'
  if (diffMin < 60) return `Last seen ${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `Last seen ${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7)    return `Last seen ${diffD}d ago`
  return `Last seen ${new Date(lastActive).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

function Avatar({ user, size = 8 }: { user: { name: string; color: string; profilePhoto: string | null }; size?: number }) {
  const photo = resolveImageUrl(user.profilePhoto)
  const s = `w-${size} h-${size}`
  return (
    <div className={`${s} rounded-full shrink-0 overflow-hidden flex items-center justify-center text-white text-xs font-bold`}
      style={{ backgroundColor: user.color }}>
      {photo ? <img src={photo} alt={user.name} className="w-full h-full object-cover" /> : getInitials(user.name)}
    </div>
  )
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return `Yesterday ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function ThreadPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId: otherId } = use(params)
  const { user: me } = useAuth()
  const [messages,     setMessages]     = useState<Message[]>([])
  const [partner,      setPartner]      = useState<PartnerInfo | null>(null)
  const [text,         setText]         = useState('')
  const [sending,      setSending]      = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [notConnected, setNotConnected] = useState(false)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [uploading,    setUploading]    = useState(false)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  // Which message has its reaction picker open (mobile-friendly: tap "+" to open).
  const [reactingId,   setReactingId]   = useState<string | null>(null)
  // Message being replied to — shows a preview above the input bar until
  // the reply is sent or dismissed.
  const [replyingTo,   setReplyingTo]   = useState<Message | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastMsgRef  = useRef<string | null>(null)

  const load = useCallback(async (since?: string) => {
    const url = since
      ? `/app/api/messages/${otherId}?since=${encodeURIComponent(since)}`
      : `/app/api/messages/${otherId}`
    // Polls every 4s — swallow transient network failures so a blip doesn't
    // throw "Failed to fetch" into error tracking; the next tick recovers.
    try {
      const d = await fetch(url, { credentials: 'include' }).then(r => r.json())
      if (!Array.isArray(d)) return
      if (since) {
        if (d.length > 0) setMessages(prev => [...prev, ...d])
      } else {
        setMessages(d)
      }
      if (d.length > 0) lastMsgRef.current = d[d.length - 1].createdAt
    } catch { /* transient — next poll retries */ }
  }, [otherId])

  // Fetch partner info independently so we have it even with no messages,
  // and refresh on a slow interval so the "last seen" stays current.
  useEffect(() => {
    function fetchPartner() {
      fetch(`/app/api/members/${otherId}`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d?.id) setPartner({
            id: d.id, name: d.name, color: d.color, profilePhoto: d.profilePhoto,
            lastActive: d.lastActive ?? null,
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

  // Poll for new messages every 4s
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastMsgRef.current) load(lastMsgRef.current)
    }, 4_000)
    return () => clearInterval(timer)
  }, [load])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length === 1 ? 'instant' : 'smooth' } as any)
  }, [messages])

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
      if (res.status === 403) { setNotConnected(true); return }
      if (!res.ok) return
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      lastMsgRef.current = msg.createdAt
      setText('')
      setPendingImage(null)
      setReplyingTo(null)
      textareaRef.current?.focus()
    } catch {
      // Network blip — keep the composed text/image so the user can retry.
    } finally {
      setSending(false)
    }
  }

  async function handleImageChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const upload = await downscaleImage(file)
    const fd = new FormData()
    fd.append('file', upload)
    fd.append('folder', 'messages')
    try {
      const r = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(r => r.json())
      // Upload route returns { url } shaped /app/api/files/<sub>/<file>.ext —
      // server validates with the same regex on send.
      if (r?.url) setPendingImage(r.url)
    } catch {
      // Upload failed (network blip) — user can retry the attachment.
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setReactingId(null)
    try {
      const r = await fetch(`/app/api/messages/${otherId}/react`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, emoji }),
      }).then(res => res.ok ? res.json() : null)
      if (!r?.reactions) return
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: r.reactions } : m))
    } catch { /* network blip — reaction not applied, safe to retry */ }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(e as any)
    }
  }

  async function deleteMessage(id: string) {
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
      if (res.ok) setMessages(prev => prev.filter(m => m.id !== id))
    } catch {
      // Network blip — leave the message in place; user can retry.
    } finally {
      setDeleting(null)
    }
  }

  const partnerName = partner?.name ?? 'Member'

  // Group messages by date
  const grouped: { date: string; msgs: Message[] }[] = []
  for (const msg of messages) {
    const d = new Date(msg.createdAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    if (grouped.length === 0 || grouped[grouped.length - 1].date !== d) {
      grouped.push({ date: d, msgs: [msg] })
    } else {
      grouped[grouped.length - 1].msgs.push(msg)
    }
  }

  return (
    <div className="flex justify-center bg-gray-100">
      <div className="flex flex-col bg-white w-full max-w-3xl shadow-sm">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href="/messages" className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600">
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
          </>
        )}
      </div>

      {/* Messages */}
      <div className="overflow-y-auto px-4 py-4 space-y-1" style={{ height: 'calc(100dvh - 240px)', minHeight: '150px' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No messages yet. Say hi to {partnerName}!
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.date}>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium whitespace-nowrap">{group.date}</span>
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
                          <p className="truncate">
                            {msg.replyTo.imageUrl && !msg.replyTo.text ? '📷 Photo' : (msg.replyTo.text || '📷 Photo')}
                          </p>
                        </div>
                      )}

                      {/* Image attachment — shown above text bubble when present */}
                      {msg.imageUrl && (
                        <a href={resolveImageUrl(msg.imageUrl)} target="_blank" rel="noopener noreferrer"
                          className={`block mb-1 ${isMe ? 'ml-auto' : ''}`}>
                          <img src={resolveImageUrl(msg.imageUrl)} alt=""
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
                              className={`px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                mine
                                  ? 'bg-amber-100 border-amber-300 text-amber-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                              }`}>
                              {emoji}{count > 1 && <span className="ml-0.5 font-semibold">{count}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Meta row — time + read receipts + delete + react button */}
                      <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-xs text-gray-400">{formatTime(msg.createdAt)}</span>
                        {isMe && (
                          <span className={`text-xs ${msg.isRead ? 'text-amber-400' : 'text-gray-300'}`} title={msg.isRead ? 'Seen' : 'Sent'}>
                            {msg.isRead ? '✓✓' : '✓'}
                          </span>
                        )}
                        {/* React + Reply buttons (always visible on mobile via tap; hover-revealed on desktop) */}
                        <button
                          onClick={() => setReactingId(r => r === msg.id ? null : msg.id)}
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
                        {isMe && (
                          <button
                            onClick={() => deleteMessage(msg.id)}
                            disabled={deleting === msg.id}
                            className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-400 transition-all ml-1"
                          >
                            {deleting === msg.id ? '…' : 'delete'}
                          </button>
                        )}
                      </div>

                      {/* Reaction picker popover */}
                      {reactingId === msg.id && (
                        <div className={`absolute z-10 mt-1 ${isMe ? 'right-0' : 'left-0'} bg-white border border-gray-200 rounded-full shadow-md px-2 py-1.5 flex gap-1`}>
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
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-3">
        {notConnected && !(me?.role === 'admin' || me?.role === 'moderator' || me?.isClubHost) ? (
          <div className="text-center text-sm text-gray-600 py-1">
            Connect with {partnerName} first to send messages.{' '}
            <Link href="/members" className="text-amber-600 hover:underline font-medium">Browse members</Link>
          </div>
        ) : (
          <div>
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
                <img src={resolveImageUrl(pendingImage)} alt="" className="max-h-32 rounded-xl border border-gray-200" />
                <button onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-gray-900 text-white rounded-full text-xs font-bold flex items-center justify-center hover:bg-gray-700">×</button>
              </div>
            )}
            <form onSubmit={send} className="flex items-end gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChoose} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
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
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pendingImage ? 'Add a caption (optional)…' : `Message ${partnerName}…`}
                rows={1}
                maxLength={2000}
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none max-h-32 overflow-y-auto"
                style={{ lineHeight: '1.5' }}
              />
              <button
                type="submit"
                disabled={(!text.trim() && !pendingImage) || sending}
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
      </div>
    </div>
  )
}
