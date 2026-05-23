'use client'

import { useState, useEffect, useRef, useCallback, use } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl, getInitials } from '@/lib/data'

interface Message {
  id: string
  text: string
  fromId: string
  toId: string
  isRead: boolean
  createdAt: string
  from: { id: string; name: string; color: string; profilePhoto: string | null }
}

interface PartnerInfo {
  id: string; name: string; color: string; profilePhoto: string | null
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
  const bottomRef  = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastMsgRef  = useRef<string | null>(null)

  const load = useCallback(async (since?: string) => {
    const url = since
      ? `/app/api/messages/${otherId}?since=${encodeURIComponent(since)}`
      : `/app/api/messages/${otherId}`
    const d = await fetch(url, { credentials: 'include' }).then(r => r.json())
    if (!Array.isArray(d)) return
    if (since) {
      if (d.length > 0) setMessages(prev => [...prev, ...d])
    } else {
      setMessages(d)
      if (d.length > 0) {
        const firstMsg = d[0]
        const p = firstMsg.from.id === otherId ? firstMsg.from : null
        if (p) setPartner(p)
      }
    }
    if (d.length > 0) lastMsgRef.current = d[d.length - 1].createdAt
  }, [otherId])

  // Fetch partner info independently so we have it even with no messages
  useEffect(() => {
    fetch(`/app/api/members/${otherId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d?.id) setPartner({ id: d.id, name: d.name, color: d.color, profilePhoto: d.profilePhoto }) })
      .catch(() => {})
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
    if (!text.trim() || sending) return
    setSending(true)
    const res = await fetch(`/app/api/messages/${otherId}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    setSending(false)
    if (res.status === 403) { setNotConnected(true); return }
    if (!res.ok) return
    const msg = await res.json()
    setMessages(prev => [...prev, msg])
    lastMsgRef.current = msg.createdAt
    setText('')
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(e as any)
    }
  }

  async function deleteMessage(id: string) {
    setDeleting(id)
    await fetch(`/app/api/messages/${otherId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: id }),
    })
    setMessages(prev => prev.filter(m => m.id !== id))
    setDeleting(null)
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
        <Link href="/messages" className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        {partner && (
          <>
            <Avatar user={partner} size={9} />
            <div className="flex-1 min-w-0">
              <Link href={`/members/${otherId}`} className="font-semibold text-gray-900 hover:underline text-sm">
                {partnerName}
              </Link>
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
                      <div
                        className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isMe
                            ? 'bg-amber-500 text-white rounded-br-sm'
                            : 'bg-white text-gray-900 shadow-sm border border-gray-100 rounded-bl-sm'
                        }`}
                      >
                        {msg.text}
                      </div>
                      <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-xs text-gray-400">{formatTime(msg.createdAt)}</span>
                        {isMe && (
                          <>
                            <span className={`text-xs ${msg.isRead ? 'text-amber-400' : 'text-gray-300'}`} title={msg.isRead ? 'Seen' : 'Sent'}>
                              {msg.isRead ? '✓✓' : '✓'}
                            </span>
                            <button
                              onClick={() => deleteMessage(msg.id)}
                              disabled={deleting === msg.id}
                              className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-400 transition-all ml-1"
                            >
                              {deleting === msg.id ? '…' : 'delete'}
                            </button>
                          </>
                        )}
                      </div>
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
          <div className="text-center text-sm text-gray-500 py-1">
            Connect with {partnerName} first to send messages.{' '}
            <Link href="/members" className="text-amber-600 hover:underline font-medium">Browse members</Link>
          </div>
        ) : (
          <form onSubmit={send} className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${partnerName}…`}
              rows={1}
              maxLength={2000}
              className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none max-h-32 overflow-y-auto"
              style={{ lineHeight: '1.5' }}
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="p-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl transition-colors shrink-0"
            >
              <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        )}
      </div>
      </div>
    </div>
  )
}
