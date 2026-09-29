'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { clubOptionLabel } from '@/lib/clubLabel'
import { ImageUploadError } from '@/lib/image-resize'
import { prepareImageUpload } from '@/lib/imageUploadGuard'
import { avatarUrl } from '@/lib/data'
import { timeAgo } from '@/lib/timeAgo'

type Channel  = 'in-app' | 'email'
type MsgType  = 'announcement' | 'reminder' | 'alert'
type Audience = 'all' | 'city' | 'club' | 'event'

interface CityOption  { id: string; name: string; status: string; memberCount?: number }
interface ClubOption  { id: string; name: string; emoji?: string; cityId?: string | null; memberCount?: number; city?: { name: string; slug: string } | null }
interface EventOption { id: string; title: string; emoji?: string; date?: string; city?: { name: string } | null; _count?: { attendees?: number } }

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
  clubId?:   string | null
  eventId?:  string | null
  imageUrl:  string | null
  // null while the fan-out is still running (the server answers 202 and
  // sends in the background). Rows from before the field were backfilled
  // to their createdAt. Finished with no counts and sentCount 0 = the
  // fan-out broke (the server stamps finishedAt in its catch, nothing else).
  finishedAt?:    string | null
  emailedCount?:  number | null
  notifiedCount?: number | null
}

// Mirrors TITLE_MAX / MESSAGE_MAX in the broadcast route.
const TITLE_MAX   = 150
const MESSAGE_MAX = 5_000
// What an inbox shows of a subject line before it clips, roughly.
const SUBJECT_SHOWN = 78
// The in-app copies of a send can be rewritten for this long after it
// (EDIT_WINDOW_MS in the route); past it an edit only corrects the record.
const EDIT_WINDOW_MS = 60 * 60_000
const MOD_SENDS_PER_DAY = 5

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

const channelLabel: Record<Channel, string> = {
  'in-app': 'In-app only',
  'email':  'Email + in-app',
}

const selectClass = 'w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none'

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

// Uploaded on pick (the same path as the post cover in PostForm), so a send
// or an edit only ever carries a URL the server itself wrote — the broadcast
// route rejects anything that isn't a 'broadcasts/' upload. Shared by the
// composer and the edit form; each keeps its own in-flight guard.
async function postImage(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const upload = await prepareImageUpload(file)
  const fd = new FormData()
  fd.append('file', upload)
  fd.append('folder', 'broadcasts')
  const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
  const data = await readJsonBody(res)
  if (!res.ok || typeof data?.url !== 'string') return { ok: false, error: data?.error ?? 'Upload failed' }
  return { ok: true, url: data.url }
}

const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`

// Event.date is text 'YYYY-MM-DD'; noon keeps the calendar day whatever the
// device's offset is.
function eventDay(date?: string): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date ?? ''
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function eventOptionLabel(e: EventOption): string {
  const head  = [e.emoji, e.title].filter(Boolean).join(' ')
  const going = e._count?.attendees
  return [head, eventDay(e.date), e.city?.name, going === undefined ? null : `${going} going`]
    .filter(v => v !== null && v !== undefined && v !== '')
    .join(' · ')
    .replace(' · ', ' — ')   // the first separator only: "🎉 Title — 3 Oct · İzmir · 12 going"
}

function clubHead(c: ClubOption): string {
  return [c.emoji, c.name].filter(Boolean).join(' ')
}

// A whole-membership email is ~16 minutes; two hours of "sending" is a
// fan-out that stopped (a restart), not one that is slow.
const STALE_SEND_MS = 2 * 60 * 60_000

const MAYBE_SENT = 'No clear answer from the server — the broadcast may still be sending. Check Broadcast History before retrying.'

export default function AdminNotificationsPage() {
  const { user } = useAuth()
  const isModerator = user.role === 'moderator'

  const [cities,    setCities]    = useState<CityOption[]>([])
  const [clubs,     setClubs]     = useState<ClubOption[]>([])
  const [events,    setEvents]    = useState<EventOption[]>([])
  // No audience until one is picked. 'all' was the landing state for admins,
  // so the least reversible send of all was also the one that needed the
  // fewest clicks.
  const [audience,  setAudience]  = useState<Audience | ''>('')
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
  const [testing,        setTesting]        = useState(false)
  const [history,        setHistory]        = useState<BroadcastRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  // A failed history load used to read "No broadcasts sent yet."
  const [historyError,   setHistoryError]   = useState<string | null>(null)
  // A moderator's remaining daily allowance; null for admins.
  const [sendsLeftToday, setSendsLeftToday] = useState<number | null>(null)
  const [confirmSend,    setConfirmSend]    = useState(false)
  const confirmRef = useRef<HTMLDivElement>(null)
  // Kept across retries of the same compose; replaced only once the server
  // confirms the send (202, or 409 "already sent").
  const [requestId,      setRequestId]      = useState(newRequestId)
  // Post-send editing (admins only). Keyed by broadcast id; null = nothing
  // open. imageUrl is the edited value — compared against the row's own
  // before saving, so an untouched image is left out of the PATCH.
  const [editing,    setEditing]    = useState<{ id: string; title: string; message: string; imageUrl: string | null } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [uploadingEditImage, setUploadingEditImage] = useState(false)
  const editImageRef = useRef<HTMLInputElement>(null)

  // The moderator's own city, from the session; the club list is the
  // fallback for a session whose payload predates the field (every
  // non-global club the server shows a moderator is in their city).
  const modCityId = isModerator
    ? (user.cityId ?? clubs.find(c => c.cityId)?.cityId ?? null)
    : null

  // Moderators can't broadcast to all members (server returns 403 since
  // commit cdcbc0d); the button is disabled, and this catches any state
  // that got there some other way.
  useEffect(() => {
    if (isModerator && audience === 'all') setAudience('')
  }, [isModerator, audience])

  // Extracted so the post-send refresh can call the same code path the
  // initial load uses. Previously this fetch was duplicated.
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/app/api/admin/notifications/broadcast', { credentials: 'include' })
      if (!res.ok) throw await loadFailure(res)
      const d = await res.json()
      // { history, sendsLeftToday } now; the bare array is the older shape.
      const rows = Array.isArray(d) ? d : Array.isArray(d?.history) ? d.history : []
      setHistory(rows)
      setSendsLeftToday(typeof d?.sendsLeftToday === 'number' ? d.sendsLeftToday : null)
      setHistoryError(null)
    } catch (e) {
      setHistoryError((e as Error)?.message ?? 'Failed to load')
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // The three option lists. A failed one used to become an empty picker,
  // which reads as "no clubs" rather than "couldn't load clubs".
  useEffect(() => {
    async function loadList<T>(path: string, what: string, apply: (rows: T[]) => void) {
      try {
        const r = await fetch(path, { credentials: 'include' })
        if (!r.ok) {
          const d = await readJsonBody(r)
          toast.error(d?.error ?? `Couldn't load ${what} (HTTP ${r.status})`)
          return
        }
        const d = await r.json()
        apply(Array.isArray(d) ? d : [])
      } catch {
        toast.error(`Network error — could not load ${what}`)
      }
    }
    loadList('/app/api/admin/cities', 'cities', setCities)
    loadList('/app/api/admin/clubs',  'clubs',  setClubs)
    loadList('/app/api/admin/events', 'events', setEvents)
    loadHistory()
  }, [loadHistory])

  // A row still fanning out changes on its own; keep the list honest while
  // one is in flight, and stop the moment none is. A row that has said
  // "sending" for hours was cut off (a restart mid-fan-out — nothing stamps
  // it afterwards): shown as such, and not polled for.
  const sendState = (b: BroadcastRecord): 'sending' | 'interrupted' | 'failed' | 'done' => {
    if (b.finishedAt === null) return Date.now() - new Date(b.createdAt).getTime() > STALE_SEND_MS ? 'interrupted' : 'sending'
    if (b.emailedCount == null && b.notifiedCount == null && b.sentCount === 0) return 'failed'
    return 'done'
  }
  const stillSending = history.some(b => sendState(b) === 'sending')
  useEffect(() => {
    if (!stillSending) return
    const t = setInterval(loadHistory, 10_000)
    const stop = () => clearInterval(t)
    return stop
  }, [stillSending, loadHistory])

  // An armed confirm belongs to exactly what was on screen when it was armed.
  // Any change to what would be sent — the audience most of all — disarms it,
  // so "Yes, send now" can never go to a different audience than the one it
  // was answered for.
  useEffect(() => {
    setConfirmSend(false)
  }, [audience, cityId, clubId, eventId, type, channel, title, message, imageUrl])

  useEffect(() => {
    if (confirmSend) confirmRef.current?.focus()
  }, [confirmSend])

  // Bumped by every send and every Remove. An upload that resolves after one
  // of those belongs to a composer that no longer exists: without this it
  // would set an image on the NEXT broadcast, which nobody picked for it.
  const uploadGen = useRef(0)
  const editUploadGen = useRef(0)

  // Drop the image AND retire any upload still running for it, so a slow
  // one can't land on the composer after it was cleared.
  function clearImage() {
    uploadGen.current++
    setUploadingImage(false)
    setImageUrl(null)
  }

  async function uploadImage(file: File) {
    const gen = ++uploadGen.current
    setUploadingImage(true)
    try {
      const r = await postImage(file)
      if (gen !== uploadGen.current) return   // superseded: sent, removed, or re-picked
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setImageUrl(r.url)
      toast.success('Image added')
    } catch (e) {
      // prepareImageUpload throws ImageUploadError with a message written to
      // be read — the iCloud-placeholder one and the too-large-to-shrink one.
      // Reporting those as a network failure sends the admin round a loop
      // that retrying can never break.
      toast.error(e instanceof ImageUploadError ? e.message : 'Network error — please try again')
    } finally {
      if (gen === uploadGen.current) setUploadingImage(false)
    }
  }

  // Same shape for the edit form, on its own counter so a replacement picked
  // there can't cancel (or be cancelled by) a composer upload.
  async function uploadEditImage(file: File) {
    const gen = ++editUploadGen.current
    setUploadingEditImage(true)
    try {
      const r = await postImage(file)
      if (gen !== editUploadGen.current) return
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setEditing(prev => prev && { ...prev, imageUrl: r.url })
    } catch (e) {
      toast.error(e instanceof ImageUploadError ? e.message : 'Network error — please try again')
    } finally {
      if (gen === editUploadGen.current) setUploadingEditImage(false)
    }
  }

  function closeEdit() {
    editUploadGen.current++
    setUploadingEditImage(false)
    setEditing(null)
  }

  async function saveEdit(original: BroadcastRecord) {
    if (!editing || !editing.title.trim() || !editing.message.trim() || uploadingEditImage) return
    setSavingEdit(true)
    try {
      const res = await fetch('/app/api/admin/notifications/broadcast', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id, title: editing.title, message: editing.message,
          // Absent = leave the image alone; null = take it off.
          ...(editing.imageUrl !== original.imageUrl ? { imageUrl: editing.imageUrl } : {}),
        }),
      })
      const data = await readJsonBody(res)
      if (!res.ok || !data) {
        toast.error(data?.error ?? 'Failed to update broadcast')
        return
      }
      const rewritten = Number(data.rewritten ?? data.notificationsUpdated) || 0
      if (rewritten === 0 || data.outsideWindow) {
        toast.warning('The record here is corrected, but no member copies changed — this send is past the hour in which they can still be rewritten. Members keep the version they received.', { duration: 10_000 })
      } else {
        toast.success(`Updated — rewrote ${plural(rewritten, 'member notification')}`)
      }
      closeEdit()
      await loadHistory()
    } catch {
      toast.error('Network error — please try again')
    } finally { setSavingEdit(false) }
  }

  // What a moderator may pick: their own city, and clubs that belong to it.
  // Global clubs (cityId null) have members everywhere, and the server 403s
  // a moderator sending to one. Events come pre-scoped by their endpoint.
  const visibleCities = isModerator ? cities.filter(c => c.id === modCityId) : cities
  const visibleClubs  = isModerator ? clubs.filter(c => !!c.cityId && c.cityId === modCityId) : clubs

  const selectedCity  = cities.find(c => c.id === cityId)
  const selectedClub  = clubs.find(c => c.id === clubId)
  const selectedEvent = events.find(e => e.id === eventId)
  // Until the city list has loaded there is no total to show, and a 0 here
  // must never read as "nobody".
  const totalMembers = cities.length ? cities.reduce((n, c) => n + (c.memberCount ?? 0), 0) : null

  // Who this would go to, by name and by size. null = not fully chosen yet.
  // count null = the option list didn't say (never shown as zero).
  const target = useMemo((): { name: string; count: number | null } | null => {
    // The counts come from the admin lists (activated members); the server
    // sends to every approved account, which is a little larger. Named so
    // the confirm never claims a precision it doesn't have.
    if (audience === 'all')   return { name: 'every member in every city', count: totalMembers }
    if (audience === 'city')  return selectedCity  ? { name: selectedCity.name, count: selectedCity.memberCount ?? null } : null
    if (audience === 'club')  return selectedClub  ? { name: clubHead(selectedClub), count: selectedClub.memberCount ?? null } : null
    if (audience === 'event') return selectedEvent ? { name: [selectedEvent.emoji, selectedEvent.title].filter(Boolean).join(' '), count: selectedEvent._count?.attendees ?? null } : null
    return null
  }, [audience, totalMembers, selectedCity, selectedClub, selectedEvent])
  const emptyAudience = !!target && target.count === 0

  // An upload still in flight blocks the send. Without this an admin who
  // picks a photo and clicks straight through sends the whole audience a
  // broadcast with no image — and an email cannot be recalled.
  const canSend = !!(
    !uploadingImage &&
    title.trim() && message.trim() &&
    target && !emptyAudience &&
    (audience !== 'all' || !isModerator) &&
    sendsLeftToday !== 0
  )
  const canTest = !!(title.trim() && message.trim()) && !uploadingImage && !testing && !sending

  // Why Send is greyed out, in words, next to it.
  const sendBlocker =
    !title.trim() || !message.trim() ? null   // the empty fields explain themselves
    : uploadingImage      ? 'Waiting for the image to finish uploading.'
    : !audience           ? 'Pick who this goes to.'
    : !target             ? `Pick a ${audience}.`
    : emptyAudience       ? `${target.name} has no members yet — there is nobody to send this to.`
    : sendsLeftToday === 0 ? 'No sends left today — ask an admin.'
    : null

  // The composed broadcast, to the signed-in staff member only: their own
  // inbox when the channel is email, and their own bell either way.
  async function sendTest() {
    if (!canTest) return
    setTesting(true)
    try {
      const res = await fetch('/app/api/admin/notifications/broadcast/test', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, type, channel, imageUrl }),
      })
      const data = await readJsonBody(res)
      if (!res.ok || !data) {
        toast.error(data?.error ?? 'Could not send the test')
        return
      }
      if (channel === 'email' && !data.email) {
        toast.warning('Test sent to your bell only — the email to you did not go out. Is your address verified and not unsubscribed?', { duration: 10_000 })
      } else {
        toast.success(channel === 'email'
          ? 'Test sent to you — check your inbox and your bell (if you haven\'t muted announcements)'
          : 'Test sent to your bell (if you haven\'t muted announcements)')
      }
    } catch {
      toast.error('Network error — please try again')
    } finally { setTesting(false) }
  }

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
          resetComposer()
          setRequestId(newRequestId())
          await loadHistory()
          return
        }
        toast.error(data.error ?? 'Failed to send broadcast')
        return
      }
      const data = await readJsonBody(res)
      if (!data) {
        toast.warning(MAYBE_SENT, { duration: 15_000 })
        await loadHistory()
        return
      }
      // 202: the row is written and the fan-out runs on after this answer
      // (a whole-membership email takes minutes). Nothing has finished yet,
      // so the toast says what was queued, not what was sent — the history
      // row carries the counts once it is done.
      const queued   = Number(data.queued) || 0
      const eligible = Number(data.emailEligible) || 0
      toast.success(
        channel === 'email'
          ? `Sending to ${plural(queued, 'member')} — ${eligible} by email (the rest are unsubscribed or unverified). Watch Broadcast History.`
          : `Sending to ${plural(queued, 'member')} — watch Broadcast History.`,
        { duration: 10_000 })
      resetComposer()
      setRequestId(newRequestId())
      await loadHistory()
    } catch {
      // A dropped connection can't tell us whether the server finished.
      toast.warning(MAYBE_SENT, { duration: 15_000 })
      await loadHistory()
    } finally { setSending(false) }
  }

  // Back to the safe starting point: no text, no image, in-app, announcement,
  // and no audience — the next send has to be aimed on purpose too.
  function resetComposer() {
    setTitle(''); setMessage(''); clearImage()
    setType('announcement'); setChannel('in-app')
    setAudience(''); setCityId(''); setClubId(''); setEventId('')
  }

  const radioClass = (on: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-medium transition-colors ${on ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700'}`

  function historyAudience(b: BroadcastRecord): string {
    if (b.audience === 'city')  return `City: ${cities.find(c => c.id === b.cityId)?.name ?? '?'}`
    if (b.audience === 'club')  { const c = clubs.find(c => c.id === b.clubId);  return `Club: ${c ? clubHead(c) : '?'}` }
    if (b.audience === 'event') { const e = events.find(e => e.id === b.eventId); return `Event: ${e ? [e.emoji, e.title].filter(Boolean).join(' ') : '?'}` }
    if (b.audience === 'all')   return 'All members'
    return b.audience
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
          <div id="bc-channel-label" className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2">Channel</div>
          <div role="radiogroup" aria-labelledby="bc-channel-label" className="flex gap-1.5">
            {(['in-app', 'email'] as Channel[]).map(c => (
              <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)}
                className={radioClass(channel === c)}>
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
            <div id="bc-audience-label" className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2">Audience</div>
            <div role="radiogroup" aria-labelledby="bc-audience-label" className="flex gap-1.5 mb-2 flex-wrap">
              {(['all', 'city', 'club', 'event'] as const).map(a => {
                // Moderators can't broadcast to all cities — server returns
                // 403. Disabled here, with the reason in text below (a
                // disabled button's tooltip never shows).
                const disabled = a === 'all' && isModerator
                return (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={audience === a}
                    onClick={() => { if (disabled) return; setAudience(a); setCityId(''); setClubId(''); setEventId('') }}
                    disabled={disabled}
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
            {isModerator && (
              <p className="text-xs text-zinc-500 mb-2">Moderators broadcast to their own city, or to a club or event in it — not to every city at once.</p>
            )}
            {audience === '' && (
              <p className="text-xs text-zinc-500">Pick who this goes to.</p>
            )}
            {audience === 'all' && (
              <p className="text-xs text-zinc-400">
                {totalMembers === null ? 'Counting members…' : `${plural(totalMembers, 'member')} across every city`}
              </p>
            )}
            {audience === 'city' && (
              <select value={cityId} onChange={e => setCityId(e.target.value)} aria-label="City" className={selectClass}>
                <option value="">Select city…</option>
                {visibleCities.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.status !== 'live' ? ' (coming soon)' : ''} — {c.memberCount === 0 ? 'no members yet' : plural(c.memberCount ?? 0, 'member')}
                  </option>
                ))}
              </select>
            )}
            {audience === 'club' && (
              <select value={clubId} onChange={e => setClubId(e.target.value)} aria-label="Club" className={selectClass}>
                <option value="">Select club…</option>
                {visibleClubs.map(c => (
                  <option key={c.id} value={c.id}>
                    {clubOptionLabel(c)} · {c.memberCount === 0 ? 'no members yet' : plural(c.memberCount ?? 0, 'member')}
                  </option>
                ))}
              </select>
            )}
            {audience === 'event' && (
              <select value={eventId} onChange={e => setEventId(e.target.value)} aria-label="Event" className={selectClass}>
                <option value="">Select event…</option>
                {events.map(e => <option key={e.id} value={e.id}>{eventOptionLabel(e)}</option>)}
              </select>
            )}
            {emptyAudience && (
              <p className="text-xs text-red-400 mt-1.5">{target?.name} has no members yet — nothing to send.</p>
            )}
          </div>

          <div>
            <div id="bc-type-label" className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2">Type</div>
            <div role="radiogroup" aria-labelledby="bc-type-label" className="flex flex-wrap gap-1.5">
              {(Object.entries(typeConfig) as [MsgType, { label: string; color: string }][]).map(([key, cfg]) => (
                <button key={key} type="button" role="radio" aria-checked={type === key} onClick={() => setType(key)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${type === key ? `${cfg.color} border border-current/20` : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700'}`}>
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label htmlFor="bc-title" className="text-zinc-400 text-xs font-semibold uppercase tracking-wide">Title</label>
            <span className={`text-xs ${title.length >= TITLE_MAX ? 'text-amber-400' : 'text-zinc-500'}`}>{title.length}/{TITLE_MAX}</span>
          </div>
          <input id="bc-title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Broadcast title…" maxLength={TITLE_MAX}
            className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:outline-none" />
          {channel === 'email' && title.length > SUBJECT_SHOWN && (
            <p className="text-xs text-amber-400 mt-1">Long for an email subject — inboxes show about {SUBJECT_SHOWN} characters before clipping it.</p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label htmlFor="bc-message" className="text-zinc-400 text-xs font-semibold uppercase tracking-wide">Message</label>
            <span className={`text-xs ${message.length >= MESSAGE_MAX ? 'text-amber-400' : 'text-zinc-500'}`}>{message.length.toLocaleString('en-US')}/{MESSAGE_MAX.toLocaleString('en-US')}</span>
          </div>
          <textarea id="bc-message" value={message} onChange={e => setMessage(e.target.value)} placeholder="Write your message…" rows={3} maxLength={MESSAGE_MAX}
            className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none" />
        </div>

        {/* Image — one, optional, and allowed on both channels: the email
            embeds it and the in-app announcement card shows it. Push stays
            text-only on purpose. */}
        <div>
          <div className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2">Image</div>
          {imageUrl ? (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
              {/* alt="" — this is the admin's own preview of the file they
                  just picked, not content that needs describing. Shown whole
                  (object-contain), the way the member card shows it. */}
              <img src={`${imageUrl}?w=800`} alt="" className="w-full max-h-60 object-contain rounded-lg bg-zinc-900" />
              <button type="button" onClick={clearImage}
                className="w-full py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                Remove
              </button>
            </div>
          ) : (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
              <button type="button" onClick={() => imageRef.current?.click()} disabled={uploadingImage}
                className="w-full py-4 border-2 border-dashed border-zinc-600 hover:border-amber-500 rounded-lg text-xs text-zinc-400 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-600">
                {uploadingImage ? 'Uploading…' : 'Add an image (optional)'}
              </button>
              <p className="text-xs text-zinc-500 mt-2">One image, shown whole: up to 496px wide in the email, and in full on the announcement card — portrait posters work too.</p>
            </div>
          )}
          {/* Kept mounted in both states, and the value is cleared on change so
              re-picking the same file after a Remove still fires onChange. */}
          <input ref={imageRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImage(f) }} />
        </div>

        {sendsLeftToday !== null && (
          <p className={`text-xs ${sendsLeftToday === 0 ? 'text-red-400' : 'text-zinc-400'}`}>
            {sendsLeftToday} of {MOD_SENDS_PER_DAY} sends left today
          </p>
        )}

        {confirmSend && target ? (
          // Focus lands here when it opens, so a keyboard or screen-reader
          // user hears what they are about to confirm before the button.
          <div ref={confirmRef} tabIndex={-1} role="group" aria-labelledby="bc-confirm-title"
            className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3 focus:outline-none focus:ring-2 focus:ring-red-500">
            <p id="bc-confirm-title" className="text-white text-sm font-semibold">About to send — there is no undo</p>
            <dl className="text-sm text-zinc-300 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-zinc-500">Channel</dt>
              <dd>{channelLabel[channel]}{channel === 'email' && ' — emails cannot be recalled'}</dd>
              <dt className="text-zinc-500">Type</dt>
              <dd>{typeConfig[type].label}</dd>
              <dt className="text-zinc-500">To</dt>
              <dd>
                <span className="text-white font-semibold">{target.name}</span>
                {target.count !== null && (
                  <> — <span className="text-white font-semibold">{plural(target.count, audience === 'event' ? 'attendee' : 'member')}</span></>
                )}
              </dd>
              <dt className="text-zinc-500">Title</dt>
              <dd className="truncate">{title.trim()}</dd>
              {imageUrl && (<><dt className="text-zinc-500">Image</dt><dd>attached</dd></>)}
            </dl>
            <div className="flex gap-2">
              <button type="button" onClick={handleSend} disabled={sending || uploadingImage}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors">
                {sending ? 'Sending…' : uploadingImage ? 'Waiting for the image…' : 'Yes, send now'}
              </button>
              <button type="button" onClick={() => setConfirmSend(false)}
                className="flex-1 py-3 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-xl transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={handleSend} disabled={!canSend || sending}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors">
                {sending ? 'Sending…' : 'Send broadcast'}
              </button>
              <button type="button" onClick={sendTest} disabled={!canTest}
                className="sm:w-auto px-4 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors">
                {testing ? 'Sending test…' : 'Send a test to myself'}
              </button>
            </div>
            {sendBlocker && <p className="text-xs text-zinc-500">{sendBlocker}</p>}
          </div>
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
            {history.map(b => {
              const withinWindow = Date.now() - new Date(b.createdAt).getTime() < EDIT_WINDOW_MS
              return (
              <div key={b.id} className="py-3 border-t border-zinc-800 first:border-t-0">
                {editing?.id === b.id ? (
                  <div className="space-y-2">
                    <input
                      value={editing.title}
                      maxLength={TITLE_MAX}
                      aria-label="Title"
                      onChange={e => setEditing(prev => prev && { ...prev, title: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                    />
                    <textarea
                      value={editing.message}
                      maxLength={MESSAGE_MAX}
                      aria-label="Message"
                      onChange={e => setEditing(prev => prev && { ...prev, message: e.target.value })}
                      rows={8}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-amber-500 resize-y"
                    />
                    {editing.imageUrl ? (
                      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
                        <img src={`${editing.imageUrl}?w=800`} alt="" className="w-full max-h-60 object-contain rounded-lg bg-zinc-900" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => editImageRef.current?.click()} disabled={uploadingEditImage}
                            className="flex-1 py-1.5 text-xs text-zinc-300 hover:text-white transition-colors disabled:opacity-40">
                            {uploadingEditImage ? 'Uploading…' : 'Replace'}
                          </button>
                          <button type="button" onClick={() => { editUploadGen.current++; setUploadingEditImage(false); setEditing(prev => prev && { ...prev, imageUrl: null }) }}
                            className="flex-1 py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => editImageRef.current?.click()} disabled={uploadingEditImage}
                        className="w-full py-3 border-2 border-dashed border-zinc-600 hover:border-amber-500 rounded-lg text-xs text-zinc-400 hover:text-amber-400 transition-colors disabled:opacity-40">
                        {uploadingEditImage ? 'Uploading…' : 'Add an image'}
                      </button>
                    )}
                    <input ref={editImageRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadEditImage(f) }} />
                    <p className={`text-xs ${withinWindow ? 'text-zinc-500' : 'text-amber-400'}`}>
                      {withinWindow
                        ? 'Members’ copies will be updated too — every recipient’s in-app notification, read or unread.'
                        : `Sent ${timeAgo(b.createdAt)} — this only corrects the record here; members keep the version they received.`}
                      {b.channel === 'email' && ' Emails already delivered can’t be changed.'}
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => saveEdit(b)} disabled={savingEdit || uploadingEditImage || !editing.title.trim() || !editing.message.trim()}
                        className="text-xs px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-colors disabled:opacity-40">
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" onClick={closeEdit}
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
                          {historyAudience(b)}
                        </span>
                        {b.channel && (
                          <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">
                            {b.channel === 'email' ? '📧 Email + in-app' : '🔔 In-app'}
                          </span>
                        )}
                        {sendState(b) === 'sending' && (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Sending…</span>
                        )}
                        {sendState(b) === 'interrupted' && (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">Interrupted</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{b.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-600 flex-wrap">
                        <span>{new Date(b.createdAt).toLocaleString()}</span>
                        <span>·</span>
                        <span>by {b.sentBy}</span>
                        <span>·</span>
                        {sendState(b) === 'sending' ? (
                          <span className="text-amber-400">still sending</span>
                        ) : sendState(b) === 'interrupted' ? (
                          <span className="text-red-400">cut off mid-send — counts unknown; members past the cut-off did not get it</span>
                        ) : sendState(b) === 'failed' ? (
                          <span className="text-red-400">the send broke before it finished — see the server log</span>
                        ) : b.emailedCount != null || b.notifiedCount != null ? (
                          // Per channel. Every email send also writes the
                          // in-app copy, so both numbers are real for it.
                          <span className="text-zinc-500">
                            {b.notifiedCount ?? 0} in-app{b.channel === 'email' ? ` · ${b.emailedCount ?? 0} emailed` : ''}
                          </span>
                        ) : (
                          <span className="text-zinc-500">{b.sentCount} sent</span>
                        )}
                      </div>
                    </div>
                    {/* Edit — admin-only (the PATCH endpoint rejects
                        moderators; hide the affordance to match). Not while
                        it is still going out: the fan-out holds the text it
                        started with, so members after the edit would get the
                        old copy while the record showed the new. */}
                    {!isModerator && sendState(b) !== 'sending' && (
                      <button
                        type="button"
                        onClick={() => setEditing({ id: b.id, title: b.title, message: b.message, imageUrl: b.imageUrl ?? null })}
                        className="shrink-0 text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                )}
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
