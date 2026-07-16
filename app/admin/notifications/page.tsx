'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'

type Channel  = 'in-app' | 'email'
type MsgType  = 'announcement' | 'reminder' | 'alert'
type Audience = 'all' | 'club' | 'event'

interface ClubOption  { id: string; name: string; emoji?: string }
interface EventOption { id: string; title: string; emoji?: string }

interface BroadcastRecord {
  id:        string
  title:     string
  message:   string
  type:      string
  audience:  string
  channel?:  string
  sentBy:    string
  sentCount: number
  createdAt: string
}

const audienceButtonLabel: Record<Audience, string> = {
  all:   'All members',
  club:  'Club',
  event: 'Event',
}

const typeConfig: Record<MsgType, { label: string; color: string }> = {
  announcement: { label: 'Announcement', color: 'bg-blue-500/20 text-blue-400' },
  reminder:     { label: 'Reminder',     color: 'bg-amber-500/20 text-amber-400' },
  alert:        { label: 'Alert',        color: 'bg-red-500/20 text-red-400' },
}

const audienceLabel: Record<string, string> = {
  all:   'All members',
  club:  'Club',
  event: 'Event',
}

export default function AdminNotificationsPage() {
  const { user } = useAuth()
  const isModerator = user.role === 'moderator'

  const [clubs,     setClubs]     = useState<ClubOption[]>([])
  const [events,    setEvents]    = useState<EventOption[]>([])
  // Moderators can't broadcast to all members (server returns 403 since
  // commit cdcbc0d). Force them onto a scoped audience on first render so
  // the UI matches the server's actual policy.
  const [audience,  setAudience]  = useState<Audience>(isModerator ? 'club' : 'all')
  const [clubId,    setClubId]    = useState('')
  const [eventId,   setEventId]   = useState('')
  const [channel,   setChannel]   = useState<Channel>('in-app')
  const [type,      setType]      = useState<MsgType>('announcement')
  const [title,     setTitle]     = useState('')
  const [message,   setMessage]   = useState('')
  const [sending,        setSending]        = useState(false)
  const [running,        setRunning]        = useState(false)
  const [history,        setHistory]        = useState<BroadcastRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [confirmSend,    setConfirmSend]    = useState(false)
  // Post-send editing (admins only) — rewrites the in-app notification
  // for every recipient. Keyed by broadcast id; null = nothing open.
  const [editing,    setEditing]    = useState<{ id: string; title: string; message: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // Sync audience when isModerator flips from false to true. The useState
  // initializer runs once at mount; AuthContext starts as GUEST so
  // isModerator is initially false and audience initializes to 'all'.
  // When /me resolves to a real moderator a tick later, the 'All members'
  // button is disabled (round-3 city-scope check) but the underlying state
  // stays 'all', leaving canSend permanently false. This nudges it to a
  // valid scope.
  useEffect(() => {
    if (isModerator && audience === 'all') setAudience('club')
  }, [isModerator, audience])

  // Extracted so the post-send refresh can call the same code path the
  // initial load uses. Previously this fetch was duplicated.
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/app/api/admin/notifications/broadcast', { credentials: 'include' })
      const d   = res.ok ? await res.json() : []
      setHistory(Array.isArray(d) ? d : [])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    fetch('/app/api/admin/clubs',  { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setClubs(Array.isArray(d) ? d : []))
    fetch('/app/api/admin/events', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setEvents(Array.isArray(d) ? d : []))
    loadHistory()
  }, [loadHistory])

  async function saveEdit() {
    if (!editing || !editing.title.trim() || !editing.message.trim()) return
    setSavingEdit(true)
    try {
      const res = await fetch('/app/api/admin/notifications/broadcast', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`Updated ✓ — rewrote ${data.notificationsUpdated} member notification${data.notificationsUpdated === 1 ? '' : 's'}`)
        setEditing(null)
        await loadHistory()
      } else {
        toast.error(data.error ?? 'Failed to update broadcast')
      }
    } catch {
      toast.error('Network error — please try again')
    } finally { setSavingEdit(false) }
  }

  const canSend = !!(
    title.trim() && message.trim() &&
    (audience === 'all'   ? !isModerator :
     audience === 'club'  ? !!clubId      :
                            !!eventId)
  )

  async function handleSend() {
    if (!canSend) return
    if (!confirmSend) { setConfirmSend(true); return }
    setConfirmSend(false)
    setSending(true)
    try {
      const res = await fetch('/app/api/admin/notifications/broadcast', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, type, channel, audience, clubId: clubId || null, eventId: eventId || null }),
      })
      const data = await res.json()
      if (res.ok) {
        // For the email channel: the server emails users with
        // emailMarketing=true and ALSO fires an in-app notification to
        // every audience member. `sent` is the email count; `skipped`
        // is users who got the in-app but not the email. The previous
        // toast made it sound like those users got nothing.
        const note = channel === 'email' && data.skipped
          ? ` (${data.skipped} got the in-app only — opted out of email)`
          : ''
        toast.success(`Sent to ${data.sent} members ✓${note}`)
        setTitle(''); setMessage('')
        await loadHistory()
      } else {
        toast.error(data.error ?? 'Failed to send notification')
      }
    } catch {
      toast.error('Network error — please try again')
    } finally { setSending(false) }
  }

  async function runCron() {
    setRunning(true)
    try {
      const res  = await fetch('/app/api/admin/cron/reminders', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? `Cron failed (HTTP ${res.status})`)
        return
      }
      // Surface every field the cron returns — previously we only showed
      // 3 of 8. Hide zero-value lines so the toast stays scannable on a
      // quiet day.
      const lines: string[] = []
      if (data.sent24h)          lines.push(`24h reminders: ${data.sent24h}`)
      if (data.sent2h)           lines.push(`2h reminders: ${data.sent2h}`)
      if (data.sentReviews)      lines.push(`Review nudges: ${data.sentReviews}`)
      if (data.sentConnections)  lines.push(`Connection pings: ${data.sentConnections}`)
      if (data.archivedCount)    lines.push(`Archived: ${data.archivedCount}`)
      if (data.expiringListings) lines.push(`Expiring listings: ${data.expiringListings}`)
      if (data.purgedPhotos)     lines.push(`Purged photos: ${data.purgedPhotos}`)
      toast.success(lines.length ? `✓ ${lines.join(' · ')}` : '✓ Nothing to send right now')
    } catch {
      toast.error('Network error — please try again')
    } finally { setRunning(false) }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">

      <div>
        <h1 className="text-white text-2xl font-extrabold">Notifications</h1>
        <p className="text-zinc-400 text-sm mt-1">Send announcements and alerts to members</p>
      </div>

      {/* Scheduled jobs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h2 className="text-white font-bold mb-1">Scheduled Jobs</h2>
        <p className="text-zinc-500 text-xs mb-4">Run manually or set up a daily cron to hit these endpoints automatically.</p>
        <div className="flex items-center justify-between gap-4 py-3 border-t border-zinc-800">
          <div>
            <p className="text-sm font-medium text-white">Event reminders + review requests</p>
            <p className="text-xs text-zinc-500 mt-0.5">24h reminders · 2h reminders · post-event review nudges</p>
            <code className="text-xs text-zinc-600 mt-1 block">/api/admin/cron/reminders</code>
          </div>
          <button
            onClick={runCron}
            disabled={running}
            className="shrink-0 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <h2 className="text-white font-bold">Compose</h2>

        {/* Channel */}
        <div>
          <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wide block mb-2">Channel</label>
          <div className="flex gap-1.5">
            {(['in-app', 'email'] as Channel[]).map(c => (
              <button key={c} onClick={() => setChannel(c)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${channel === c ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700'}`}>
                {c === 'in-app' ? '🔔 In-app only' : '📧 Email + in-app'}
              </button>
            ))}
          </div>
          {channel === 'email' && (
            <p className="text-xs text-amber-400 mt-1.5">Members who unsubscribed from newsletters will be skipped.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wide block mb-2">Audience</label>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {(['all', 'club', 'event'] as const).map(a => {
                // Moderators can't broadcast to all cities — server returns
                // 403. Disable the button + show a tooltip rather than
                // letting them click into a guaranteed failure.
                const disabled = a === 'all' && isModerator
                return (
                  <button
                    key={a}
                    onClick={() => { if (disabled) return; setAudience(a); setClubId(''); setEventId('') }}
                    disabled={disabled}
                    title={disabled ? 'Moderators can only broadcast to a specific club or event in their city' : undefined}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors flex-1 sm:flex-none ${
                      disabled
                        ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed border border-zinc-800'
                        : audience === a
                          ? 'bg-zinc-700 text-white'
                          : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700'
                    }`}
                  >
                    {audienceButtonLabel[a]}
                  </button>
                )
              })}
            </div>
            {audience === 'club' && (
              <select value={clubId} onChange={e => setClubId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none">
                <option value="">Select club…</option>
                {clubs.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            )}
            {audience === 'event' && (
              <select value={eventId} onChange={e => setEventId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none">
                <option value="">Select event…</option>
                {events.map(e => <option key={e.id} value={e.id}>{e.emoji} {e.title}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wide block mb-2">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(typeConfig) as [MsgType, any][]).map(([key, cfg]) => (
                <button key={key} onClick={() => setType(key)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${type === key ? `${cfg.color} border border-current/20` : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700'}`}>
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wide block mb-1">Title</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Notification title…"
            className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:outline-none" />
        </div>

        <div>
          <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wide block mb-1">Message</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Write your message…" rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none" />
        </div>

        {confirmSend ? (
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={sending}
              className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors">
              {sending ? 'Sending…' : 'Yes, send now'}
            </button>
            <button onClick={() => setConfirmSend(false)}
              className="flex-1 py-3 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={handleSend} disabled={!canSend || sending}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors">
            {sending ? 'Sending…' : 'Send Notification'}
          </button>
        )}
      </div>

      {/* Broadcast history */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h2 className="text-white font-bold mb-4">Broadcast History</h2>
        {loadingHistory ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-zinc-600 text-sm italic">No broadcasts sent yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map(b => (
              <div key={b.id} className="py-3 border-t border-zinc-800 first:border-t-0">
                {editing?.id === b.id ? (
                  <div className="space-y-2">
                    <input
                      value={editing.title}
                      onChange={e => setEditing(prev => prev && { ...prev, title: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                    />
                    <textarea
                      value={editing.message}
                      onChange={e => setEditing(prev => prev && { ...prev, message: e.target.value })}
                      rows={8}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-amber-500 resize-y"
                    />
                    <p className="text-xs text-zinc-500">
                      Saving rewrites this broadcast&apos;s in-app notification for every recipient, read or unread.
                      {b.channel === 'email' && ' Emails already delivered can’t be changed.'}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={savingEdit || !editing.title.trim() || !editing.message.trim()}
                        className="text-xs px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-colors disabled:opacity-40">
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="text-xs px-3 py-2 rounded-lg text-zinc-400 hover:text-white transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{b.title}</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full capitalize ${typeConfig[b.type as MsgType]?.color ?? 'bg-zinc-700 text-zinc-400'}`}>
                          {b.type}
                        </span>
                        <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">
                          {audienceLabel[b.audience] ?? b.audience}
                        </span>
                        {b.channel && (
                          <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">
                            {b.channel === 'email' ? '📧 Email + in-app' : '🔔 In-app'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{b.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-600">
                        <span>{new Date(b.createdAt).toLocaleString()}</span>
                        <span>·</span>
                        <span>by {b.sentBy}</span>
                        <span>·</span>
                        <span className="text-zinc-500">{b.sentCount} sent</span>
                      </div>
                    </div>
                    {/* Edit — admin-only (the PATCH endpoint rejects
                        moderators; hide the affordance to match). */}
                    {!isModerator && (
                      <button
                        onClick={() => setEditing({ id: b.id, title: b.title, message: b.message })}
                        className="shrink-0 text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
