'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { clubOptionLabel } from '@/lib/clubLabel'
import { downscaleImage, ImageUploadError } from '@/lib/image-resize'
import { avatarUrl } from '@/lib/data'

type Channel  = 'in-app' | 'email'
type MsgType  = 'announcement' | 'reminder' | 'alert'
type Audience = 'all' | 'city' | 'club' | 'event'

interface CityOption  { id: string; name: string; status: string }
interface ClubOption  { id: string; name: string; emoji?: string; city?: { name: string; slug: string } | null }
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
  cityId?:   string | null
  imageUrl:  string | null
}

const audienceButtonLabel: Record<Audience, string> = {
  all:   'All members',
  city:  'City',
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
  city:  'City',
  club:  'Club',
  event: 'Event',
}

// One id per composed broadcast, sent with every attempt at it. The server
// claims it before sending, so a retry after a timeout answers 409 instead of
// emailing everyone a second time. randomUUID is missing outside secure
// contexts, hence the fallback (still matches the server's id pattern).
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// A slow send can come back as nginx's HTML 504 page; parsing that threw and
// read as "Network error — please try again", which invited a double send.
async function readJsonBody(res: Response): Promise<Record<string, any> | null> {
  try {
    const d = JSON.parse(await res.text())
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null
  } catch { return null }
}

const MAYBE_SENT = 'No clear answer from the server — the broadcast may still be sending. Check Broadcast History before retrying.'

export default function AdminNotificationsPage() {
  const { user } = useAuth()
  const isModerator = user.role === 'moderator'

  const [cities,    setCities]    = useState<CityOption[]>([])
  const [clubs,     setClubs]     = useState<ClubOption[]>([])
  const [events,    setEvents]    = useState<EventOption[]>([])
  // Moderators can't broadcast to all members (server returns 403 since
  // commit cdcbc0d). Force them onto a scoped audience on first render so
  // the UI matches the server's actual policy.
  const [audience,  setAudience]  = useState<Audience>(isModerator ? 'club' : 'all')
  const [cityId,    setCityId]    = useState('')
  const [clubId,    setClubId]    = useState('')
  const [eventId,   setEventId]   = useState('')
  const [channel,   setChannel]   = useState<Channel>('in-app')
  const [type,      setType]      = useState<MsgType>('announcement')
  const [title,     setTitle]     = useState('')
  const [message,   setMessage]   = useState('')
  // The optional broadcast image, held as the path /api/upload handed back.
  // null = no image; the send payload never carries anything else.
  const [imageUrl,  setImageUrl]  = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageRef = useRef<HTMLInputElement>(null)
  const [sending,        setSending]        = useState(false)
  const [history,        setHistory]        = useState<BroadcastRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  // A failed history load used to read "No broadcasts sent yet."
  const [historyError,   setHistoryError]   = useState<string | null>(null)
  const [confirmSend,    setConfirmSend]    = useState(false)
  // Kept across retries of the same compose; replaced only once the server
  // confirms the send (200, or 409 "already sent").
  const [requestId,      setRequestId]      = useState(newRequestId)
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
      if (!res.ok) throw await loadFailure(res)
      const d   = await res.json()
      setHistory(Array.isArray(d) ? d : [])
      setHistoryError(null)
    } catch (e) {
      setHistoryError((e as Error)?.message ?? 'Failed to load')
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    fetch('/app/api/admin/cities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCities(Array.isArray(d) ? d : []))
    fetch('/app/api/admin/clubs',  { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setClubs(Array.isArray(d) ? d : []))
    fetch('/app/api/admin/events', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setEvents(Array.isArray(d) ? d : []))
    loadHistory()
  }, [loadHistory])

  // Bumped by every send and every Remove. An upload that resolves after one
  // of those belongs to a composer that no longer exists: without this it
  // would set an image on the NEXT broadcast, which nobody picked for it.
  const uploadGen = useRef(0)

  // Drop the image AND retire any upload still running for it, so a slow
  // one can't land on the composer after it was cleared.
  function clearImage() {
    uploadGen.current++
    setUploadingImage(false)
    setImageUrl(null)
  }

  // Uploaded on pick (the same path as the post cover in PostForm), so the
  // send payload only ever carries a URL the server itself wrote — the
  // broadcast route rejects anything that isn't a 'broadcasts/' upload.
  async function uploadImage(file: File) {
    const gen = ++uploadGen.current
    setUploadingImage(true)
    try {
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'broadcasts')
      const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await readJsonBody(res)
      if (gen !== uploadGen.current) return   // superseded: sent, removed, or re-picked
      if (!res.ok || typeof data?.url !== 'string') {
        toast.error(data?.error ?? 'Upload failed')
        return
      }
      setImageUrl(data.url)
      toast.success('Image added')
    } catch (e) {
      // downscaleImage throws ImageUploadError with a message written to be
      // read — the iCloud-placeholder one and the too-large-to-shrink one.
      // Reporting those as a network failure sends the admin round a loop
      // that retrying can never break.
      toast.error(e instanceof ImageUploadError ? e.message : 'Network error — please try again')
    } finally {
      if (gen === uploadGen.current) setUploadingImage(false)
    }
  }

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

  // An upload still in flight blocks the send. Without this an admin who
  // picks a photo and clicks straight through sends the whole audience a
  // broadcast with no image — and an email cannot be recalled.
  const canSend = !!(
    !uploadingImage &&
    title.trim() && message.trim() &&
    (audience === 'all'   ? !isModerator :
     audience === 'city'  ? !!cityId      :
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
        body: JSON.stringify({ title, message, type, channel, audience, cityId: cityId || null, clubId: clubId || null, eventId: eventId || null, imageUrl, requestId }),
      })
      // res.ok first, then a defensive parse: a non-JSON answer (gateway
      // timeout, proxy error) means we don't know whether it went out, so
      // the id is kept and the admin is pointed at history, not at Retry.
      if (!res.ok) {
        const data = await readJsonBody(res)
        if (!data) {
          toast.warning(MAYBE_SENT, { duration: 15_000 })
          await loadHistory()
          return
        }
        if (res.status === 409) {
          // The earlier attempt did go out — this compose is finished.
          toast.info(data.error ?? 'This broadcast was already sent')
          setTitle(''); setMessage(''); clearImage(); setRequestId(newRequestId())
          await loadHistory()
          return
        }
        toast.error(data.error ?? 'Failed to send notification')
        return
      }
      const data = await readJsonBody(res)
      if (!data) {
        toast.warning(MAYBE_SENT, { duration: 15_000 })
        await loadHistory()
        return
      }
      // Real counts from the server: in-app writes that landed, emails Resend
      // accepted, and what failed. For the email channel every audience
      // member also gets the in-app; `skipped` opted out of email.
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
      const notified     = Number(data.notified)     || 0
      const emailed      = Number(data.emailed)      || 0
      const emailFailed  = Number(data.emailFailed)  || 0
      const notifyFailed = Number(data.notifyFailed) || 0
      const skipped      = Number(data.skipped)      || 0
      const parts = [`${notified} notified in-app`]
      if (channel === 'email') parts.push(`${emailed} emailed`)
      if (skipped) parts.push(`${skipped} opted out of email`)
      const failed = [
        emailFailed  ? `${plural(emailFailed, 'email')} failed` : '',
        notifyFailed ? `${plural(notifyFailed, 'in-app notification')} failed` : '',
      ].filter(Boolean)
      if (failed.length) {
        toast.warning(`Sent with failures — ${parts.join(' · ')} · ${failed.join(' · ')}. Failed emails are logged; don't resend to everyone.`, { duration: 15_000 })
      } else {
        toast.success(`Sent ✓ — ${parts.join(' · ')}`)
      }
      setTitle(''); setMessage(''); clearImage(); setRequestId(newRequestId())
      await loadHistory()
    } catch {
      // A dropped connection can't tell us whether the server finished.
      toast.warning(MAYBE_SENT, { duration: 15_000 })
      await loadHistory()
    } finally { setSending(false) }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">

      <div>
        <h1 className="text-white text-2xl font-extrabold">Broadcasts</h1>
        <p className="text-zinc-400 text-sm mt-1">Announcements and alerts you send to members</p>
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
              {(['all', 'city', 'club', 'event'] as const).map(a => {
                // Moderators can't broadcast to all cities — server returns
                // 403. Disable the button + show a tooltip rather than
                // letting them click into a guaranteed failure.
                const disabled = a === 'all' && isModerator
                return (
                  <button
                    key={a}
                    onClick={() => { if (disabled) return; setAudience(a); setCityId(''); setClubId(''); setEventId('') }}
                    disabled={disabled}
                    title={disabled ? 'Moderators can broadcast to their own city, or to a club or event in it — not to every city at once' : undefined}
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
            {audience === 'city' && (
              <select value={cityId} onChange={e => setCityId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none">
                <option value="">Select city…</option>
                {cities.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.status !== 'live' ? ' (coming soon)' : ''}</option>
                ))}
              </select>
            )}
            {audience === 'club' && (
              <select value={clubId} onChange={e => setClubId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none">
                <option value="">Select club…</option>
                {clubs.map(c => <option key={c.id} value={c.id}>{clubOptionLabel(c)}</option>)}
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

        {/* Image — one, optional, and allowed on both channels: the email
            embeds it and the in-app announcement card shows it. Push stays
            text-only on purpose. */}
        <div>
          <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wide block mb-2">Image</label>
          {imageUrl ? (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
              {/* alt="" — this is the admin's own preview of the file they
                  just picked, not content that needs describing. */}
              <img src={imageUrl} alt="" className="w-full max-h-40 object-cover rounded-lg" />
              <button onClick={clearImage}
                className="w-full py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                Remove
              </button>
            </div>
          ) : (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
              <button onClick={() => imageRef.current?.click()} disabled={uploadingImage}
                className="w-full py-4 border-2 border-dashed border-zinc-600 hover:border-amber-500 rounded-lg text-xs text-zinc-400 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-600">
                {uploadingImage ? 'Uploading…' : 'Add an image (optional)'}
              </button>
              <p className="text-xs text-zinc-500 mt-2">Shown in the email and on the announcement card. One image, landscape reads best.</p>
            </div>
          )}
          {/* Kept mounted in both states, and the value is cleared on change so
              re-picking the same file after a Remove still fires onChange. */}
          <input ref={imageRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImage(f) }} />
        </div>

        {confirmSend ? (
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={sending || uploadingImage}
              className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors">
              {sending ? 'Sending…' : uploadingImage ? 'Waiting for the image…' : 'Yes, send now'}
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
        <LoadErrorBanner message={historyError} onRetry={loadHistory} title="Couldn't load broadcast history" className="mb-4" />
        {loadingHistory ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : historyError && history.length === 0 ? null : history.length === 0 ? (
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
                    {/* Which sends carried an image, at a glance. alt="" — the
                        title sits right next to it. */}
                    {b.imageUrl && (
                      <img src={avatarUrl(b.imageUrl, 64)} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-zinc-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{b.title}</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full capitalize ${typeConfig[b.type as MsgType]?.color ?? 'bg-zinc-700 text-zinc-400'}`}>
                          {b.type}
                        </span>
                        <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">
                          {b.audience === 'city'
                            ? `City: ${cities.find(c => c.id === b.cityId)?.name ?? '?'}`
                            : audienceLabel[b.audience] ?? b.audience}
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
