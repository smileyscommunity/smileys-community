'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import RichTextEditor from '@/components/RichTextEditor'

type Segment = 'all' | 'new' | 'active' | 'inactive'

interface SentNewsletter {
  id: string
  subject: string
  bodyHtml: string
  segment: string
  status: string
  scheduledFor: string | null
  recipientCount: number
  openCount: number
  clickCount: number
  unsubscribeCount: number
  sentAt: string
  sentBy: { name: string }
}

const SEGMENT_LABELS: Record<Segment, string> = {
  all:      'All opted-in',
  new:      'New members (60d)',
  active:   'Active members (90d)',
  inactive: 'Inactive members (180d+)',
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60)    return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)    return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)    return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)    return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function formatScheduled(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function NewsletterRow({ n, onDuplicate }: {
  n: SentNewsletter
  onDuplicate: (subject: string, body: string, segment: string) => void
}) {
  const [open, setOpen] = useState(false)
  const openRate  = n.recipientCount > 0 ? Math.round((n.openCount  / n.recipientCount) * 100) : 0
  const clickRate = n.recipientCount > 0 ? Math.round((n.clickCount / n.recipientCount) * 100) : 0
  const unsubRate = n.recipientCount > 0 ? Math.round((n.unsubscribeCount / n.recipientCount) * 100) : 0
  const segLabel  = SEGMENT_LABELS[n.segment as Segment] ?? n.segment
  const isScheduled = n.status === 'scheduled'
  const isSending   = n.status === 'sending'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-200 truncate">{n.subject}</p>
            {isScheduled && (
              <span className="shrink-0 text-[10px] font-bold text-blue-300 bg-blue-500/15 px-2 py-0.5 rounded-full">
                Scheduled
              </span>
            )}
            {isSending && (
              <span className="shrink-0 text-[10px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full">
                Sending…
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {n.sentBy.name} ·{' '}
            {isScheduled && n.scheduledFor
              ? `Scheduled for ${formatScheduled(n.scheduledFor)}`
              : timeAgo(n.sentAt)
            }
            {' · '}<span className="text-zinc-600">{segLabel}</span>
          </p>
        </div>
        {!isScheduled && !isSending && (
          <div className="hidden sm:flex items-center gap-3 shrink-0 text-xs text-zinc-500">
            <span title="Open rate">👁 {openRate}%</span>
            <span title="Click rate">🔗 {clickRate}%</span>
            {n.unsubscribeCount > 0 && <span title="Unsubscribe rate" className="text-red-400">↩ {unsubRate}%</span>}
          </div>
        )}
        <span className="shrink-0 text-xs text-zinc-400 bg-zinc-800 rounded-lg px-2.5 py-1">
          {isScheduled ? `~${SEGMENT_LABELS[n.segment as Segment] ?? n.segment}` : `${n.recipientCount.toLocaleString()} sent`}
        </span>
        <svg className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-zinc-800">
          {!isScheduled && !isSending && (
            <div className="flex items-center gap-6 px-4 py-3 bg-zinc-800/40">
              <div className="text-center">
                <p className="text-lg font-bold text-zinc-200">{n.openCount.toLocaleString()}</p>
                <p className="text-xs text-zinc-500">opens · {openRate}%</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-zinc-200">{n.clickCount.toLocaleString()}</p>
                <p className="text-xs text-zinc-500">clicks · {clickRate}%</p>
              </div>
              {n.unsubscribeCount > 0 && (
                <div className="text-center">
                  <p className="text-lg font-bold text-red-400">{n.unsubscribeCount.toLocaleString()}</p>
                  <p className="text-xs text-zinc-500">unsubscribed · {unsubRate}%</p>
                </div>
              )}
              <div className="ml-auto">
                <button
                  onClick={() => onDuplicate(n.subject, n.bodyHtml, n.segment)}
                  className="text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20"
                >
                  Use as template ↑
                </button>
              </div>
            </div>
          )}
          {isScheduled && (
            <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/40">
              <p className="text-xs text-zinc-400 flex-1">
                Will send to all <strong>{segLabel}</strong> members at {n.scheduledFor ? formatScheduled(n.scheduledFor) : '—'}
              </p>
              <button
                onClick={() => onDuplicate(n.subject, n.bodyHtml, n.segment)}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20"
              >
                Use as template ↑
              </button>
            </div>
          )}
          <div
            className="px-4 pb-4 pt-3 text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none bg-white"
            dangerouslySetInnerHTML={{ __html: n.bodyHtml }}
          />
        </div>
      )}
    </div>
  )
}

export default function NewsletterPage() {
  const [subject,          setSubject]          = useState('')
  const [bodyHtml,         setBodyHtml]         = useState('')
  const [segment,          setSegment]          = useState<Segment>('all')
  const [scheduleMode,     setScheduleMode]     = useState(false)
  const [scheduledFor,     setScheduledFor]     = useState('')
  const [sending,          setSending]          = useState(false)
  const [segmentCounts,    setSegmentCounts]    = useState<Record<Segment, number>>({ all: 0, new: 0, active: 0, inactive: 0 })
  const [sampleRecipients, setSampleRecipients] = useState<string[]>([])
  const [history,          setHistory]          = useState<SentNewsletter[]>([])
  const [loading,          setLoading]          = useState(true)
  const [confirm,          setConfirm]          = useState(false)
  const [insertingEvents,  setInsertingEvents]  = useState(false)
  const composerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/app/api/admin/newsletter', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setSegmentCounts(d.segmentCounts ?? { all: 0, new: 0, active: 0, inactive: 0 })
        setHistory(d.newsletters ?? [])
        setSampleRecipients(d.sampleRecipients ?? [])
      })
      .catch(() => toast.error('Failed to load newsletter data'))
      .finally(() => setLoading(false))
  }, [])

  function handleDuplicate(s: string, b: string, seg: string) {
    setSubject(s)
    setBodyHtml(b)
    setSegment((seg as Segment) in SEGMENT_LABELS ? seg as Segment : 'all')
    setScheduleMode(false)
    setScheduledFor('')
    setConfirm(false)
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    toast.success('Template loaded — edit and send when ready')
  }

  // One-click weekly digest: pull the next 7 days of published events and drop
  // a formatted, linked list into the body. Admin still reviews + sends.
  async function insertUpcomingEvents() {
    setInsertingEvents(true)
    try {
      const res  = await fetch('/app/api/events?upcoming=1&limit=50', { credentials: 'include' })
      const data = await res.json()
      const all: Array<{ id: string; title: string; date: string; neighborhood?: string | null; emoji?: string; status?: string }> =
        Array.isArray(data.events) ? data.events : []
      // Dates are 'YYYY-MM-DD' strings → lexical compare works. Window = today
      // through today+7, Istanbul.
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
      const end   = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
      const week  = all.filter(e => e.status !== 'cancelled' && e.date >= today && e.date <= end)
      if (week.length === 0) { toast('No events in the next 7 days'); return }

      const origin = window.location.origin
      const items = week.map(e => {
        const d   = new Date(e.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        const loc = e.neighborhood ? ` · ${e.neighborhood}` : ''
        const em  = e.emoji ? `${e.emoji} ` : ''
        return `<li><a href="${origin}/app/events/${e.id}">${em}${e.title}</a> — ${d}${loc}</li>`
      }).join('')
      const digest = `<h3>📅 This week's events</h3><ul>${items}</ul>`

      setBodyHtml(prev => (prev.trim() ? `${prev}${digest}` : digest))
      if (!subject.trim()) setSubject('This week at Smileys 📅')
      toast.success(`Inserted ${week.length} event${week.length !== 1 ? 's' : ''}`)
    } catch {
      toast.error('Could not load upcoming events')
    } finally {
      setInsertingEvents(false)
    }
  }

  async function send() {
    if (!subject.trim() || !bodyHtml.trim()) return
    if (scheduleMode && !scheduledFor) { toast.error('Pick a date and time to schedule'); return }
    setSending(true)
    setConfirm(false)
    try {
      const res = await fetch('/app/api/admin/newsletter', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:      subject.trim(),
          bodyHtml:     bodyHtml.trim(),
          segment,
          scheduledFor: scheduleMode ? scheduledFor : undefined,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d?.error ?? 'Send failed'); return }

      if (d.scheduled) {
        toast.success(`Scheduled for ${formatScheduled(d.scheduledFor)}`)
        setHistory(prev => [{
          id: d.newsletterId, subject: subject.trim(), bodyHtml: bodyHtml.trim(),
          segment, status: 'scheduled', scheduledFor: d.scheduledFor,
          recipientCount: 0, openCount: 0, clickCount: 0, unsubscribeCount: 0,
          sentAt: new Date().toISOString(), sentBy: { name: 'You' },
        }, ...prev])
      } else {
        toast.success(`Sent to ${d.sent} member${d.sent !== 1 ? 's' : ''}${d.failed > 0 ? ` · ${d.failed} failed` : ''}`)
        setHistory(prev => [{
          id: d.newsletterId, subject: subject.trim(), bodyHtml: bodyHtml.trim(),
          segment, status: 'sent', scheduledFor: null,
          recipientCount: d.sent, openCount: 0, clickCount: 0, unsubscribeCount: 0,
          sentAt: new Date().toISOString(), sentBy: { name: 'You' },
        }, ...prev])
      }
      setSubject('')
      setBodyHtml('')
      setScheduleMode(false)
      setScheduledFor('')
    } finally { setSending(false) }
  }

  const currentCount = segmentCounts[segment] ?? 0
  const canSend = subject.trim().length > 0 && bodyHtml.trim().length > 0 && !sending && currentCount > 0

  function recipientPreview() {
    const names = sampleRecipients.slice(0, 3)
    const rest  = currentCount - names.length
    if (names.length === 0) return `${currentCount} members`
    return rest > 0 ? `${names.join(', ')} and ${rest} others` : names.join(', ')
  }

  const segments: { key: Segment; desc: string }[] = [
    { key: 'all',      desc: 'Everyone who opted in' },
    { key: 'new',      desc: 'Joined in the last 60 days' },
    { key: 'active',   desc: 'Attended an event in the last 90 days' },
    { key: 'inactive', desc: 'No event attendance in 180+ days' },
  ]

  // Min datetime for the scheduler — 5 minutes from now
  const minSchedule = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Newsletter</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Send an email to opted-in members.</p>
      </div>

      <div ref={composerRef} className="max-w-2xl space-y-5 mb-10">
        {/* Segment picker */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Audience</label>
          <div className="grid grid-cols-2 gap-2">
            {segments.map(s => (
              <button
                key={s.key}
                onClick={() => setSegment(s.key)}
                className={`text-left px-3 py-2.5 rounded-xl border text-xs transition-colors ${
                  segment === s.key
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500'
                }`}
              >
                <span className="font-semibold block">{SEGMENT_LABELS[s.key]}</span>
                <span className="text-zinc-500 block mt-0.5">{segmentCounts[s.key].toLocaleString()} members · {s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            maxLength={200}
            placeholder="What's this newsletter about?"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <p className="text-right text-xs text-zinc-600 mt-1">{subject.length}/200</p>
        </div>

        {/* Body */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest">
              Body <span className="text-zinc-600 normal-case font-normal">(format with the toolbar — bold, headings, lists, links)</span>
            </label>
            <button
              type="button"
              onClick={insertUpcomingEvents}
              disabled={insertingEvents}
              title="Add a formatted list of the next 7 days of events"
              className="shrink-0 text-xs font-semibold text-amber-400 hover:text-amber-300 border border-zinc-700 hover:border-amber-500/50 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
            >
              {insertingEvents ? 'Loading…' : "📅 Insert this week's events"}
            </button>
          </div>
          <RichTextEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            placeholder="Hi everyone, here's what's coming up this week…"
          />
          <p className={`text-right text-xs mt-1 ${bodyHtml.length > 90_000 ? 'text-red-400' : 'text-zinc-600'}`}>
            {(bodyHtml.length / 1000).toFixed(1)} KB / 100 KB
          </p>
        </div>

        {/* Preview */}
        {bodyHtml.trim() && (
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Preview</p>
            <div
              className="bg-white rounded-xl p-6 text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none border border-zinc-700"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        )}

        {/* Schedule toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setScheduleMode(v => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${scheduleMode ? 'bg-amber-500' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${scheduleMode ? 'translate-x-4.5' : 'translate-x-1'}`} />
          </button>
          <span className="text-sm text-zinc-400">Schedule for later</span>
        </div>

        {scheduleMode && (
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Send at</label>
            <input
              type="datetime-local"
              value={scheduledFor}
              min={minSchedule}
              onChange={e => setScheduledFor(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        )}

        {/* Confirm + send */}
        {confirm ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-4 space-y-3">
            <p className="text-sm text-amber-300">
              {scheduleMode && scheduledFor
                ? <>Schedule for <strong>{formatScheduled(scheduledFor)}</strong> to <strong>{currentCount.toLocaleString()} members</strong> ({SEGMENT_LABELS[segment]})?</>
                : <>Send to <strong>{currentCount.toLocaleString()} members</strong> ({SEGMENT_LABELS[segment]})? This cannot be undone.</>
              }
            </p>
            {sampleRecipients.length > 0 && (
              <p className="text-xs text-zinc-500">Includes: {recipientPreview()}</p>
            )}
            <div className="flex items-center gap-3">
              <button onClick={() => setConfirm(false)} className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={send} disabled={sending} className="text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors">
                {sending ? (scheduleMode ? 'Scheduling…' : 'Sending…') : (scheduleMode ? 'Confirm schedule' : 'Confirm send')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            disabled={!canSend}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {currentCount > 0
              ? scheduleMode ? 'Schedule newsletter' : `Send to ${currentCount.toLocaleString()} members`
              : 'No recipients in this segment'}
          </button>
        )}
      </div>

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">Sent history</h2>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-zinc-800 animate-pulse" />)}
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-zinc-600">No newsletters sent yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map(n => <NewsletterRow key={n.id} n={n} onDuplicate={handleDuplicate} />)}
          </div>
        )}
      </div>
    </div>
  )
}
