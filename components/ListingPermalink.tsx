'use client'

// The interactive parts of the /board/[id] permalink — the gallery, and the
// save / contact / report row.
//
// The permalink is a server page, and everything that needed a click lived
// only in the marketplace sheet: opening a shared link gave you one photo, no
// way to message the seller (the in-app DM is the primary path — the sheet has
// had it for a while), and nothing to report. This is that row, kept small and
// deliberately not a copy of the sheet's own markup.

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import posthog from 'posthog-js'
import { resolveImageUrl } from '@/lib/data'

export function ListingGallery({ photos, alt, position }: {
  photos: string[]
  alt: string
  position: number
}) {
  const [active, setActive] = useState(0)
  const shown = resolveImageUrl(photos[active] ?? photos[0])
  if (!shown) return null

  return (
    <div className="bg-gray-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shown} alt={alt} className="w-full max-h-[60vh] object-contain"
        style={{ objectPosition: `center ${position}%` }} />
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-3 bg-white border-t border-gray-100">
          {photos.map((u, i) => {
            const thumb = resolveImageUrl(u)
            return (
              <button key={u} onClick={() => setActive(i)} aria-label={`Photo ${i + 1} of ${photos.length}`}
                aria-current={i === active}
                className={`shrink-0 rounded-xl overflow-hidden border-2 transition-colors ${
                  i === active ? 'border-amber-500' : 'border-transparent hover:border-gray-200'
                }`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb ?? ''} alt="" className="w-16 h-16 object-cover" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ListingActions({ listingId, category, sellerFirstName, sellerId, title, initiallySaved, canContact }: {
  listingId: string
  category: string
  sellerFirstName: string
  sellerId: string
  title: string
  initiallySaved: boolean
  // False for the owner and for a listing that has stopped being active —
  // the contact endpoint refuses both, so the button must not be there.
  canContact: boolean
}) {
  const [saved, setSaved]     = useState(initiallySaved)
  const [saving, setSaving]   = useState(false)
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState(`Hi ${sellerFirstName}, I'm interested in "${title.slice(0, 40)}". Is it still available?`)
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [reportOpen, setReportOpen]     = useState(false)
  const [reason, setReason]             = useState('')
  const [details, setDetails]           = useState('')
  const [reporting, setReporting]       = useState(false)

  async function toggleSave() {
    setSaving(true)
    const next = !saved
    setSaved(next)
    try {
      const res = await fetch(`/app/api/listings/${listingId}/save`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error()
      toast.success(next ? 'Saved!' : 'Removed from saved')
    } catch {
      setSaved(!next)
      toast.error('Could not update — check your connection')
    } finally {
      setSaving(false)
    }
  }

  async function send() {
    setSending(true)
    try {
      const res = await fetch(`/app/api/listings/${listingId}/contact`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not send'); return }
      setSent(true); setOpen(false)
      posthog.capture('listing_contacted', { category, from: 'permalink' })
      toast.success('Message sent — replies land in your Messages')
    } catch {
      toast.error('Network error')
    } finally {
      setSending(false)
    }
  }

  async function submitReport() {
    if (!reason) { toast.error('Pick a reason'); return }
    setReporting(true)
    try {
      const res = await fetch(`/app/api/listings/${listingId}/report`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, details: details || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not submit report'); return }
      toast.success('Reported — thanks. Moderators will review.')
      setReportOpen(false); setReason(''); setDetails('')
    } catch {
      toast.error('Network error')
    } finally {
      setReporting(false)
    }
  }

  return (
    <div className="space-y-2">
      {sent ? (
        <Link href={`/messages/${sellerId}`}
          className="block text-center w-full py-3.5 bg-green-100 text-green-800 text-sm font-bold rounded-2xl">
          ✓ Sent — open the conversation →
        </Link>
      ) : canContact && (
        open ? (
          <div className="space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={300}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)}
                className="px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
              <button onClick={send} disabled={sending || !text.trim()}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors">
                {sending ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOpen(true)}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-2xl transition-colors">
            💬 Contact {sellerFirstName}
          </button>
        )
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button onClick={toggleSave} disabled={saving}
          className={`flex items-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
            saved ? 'text-red-500' : 'text-gray-400 hover:text-red-400'
          }`}>
          <svg aria-hidden="true" className="w-4 h-4" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          {saved ? 'Saved' : 'Save for later'}
        </button>
        {/* Reporting is members-only for the same reason as in the sheet: an
            anonymous flag button is a spam vector. */}
        {!reportOpen && (
          <button onClick={() => setReportOpen(true)} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
            <span aria-hidden="true">⚑ </span>Report listing
          </button>
        )}
      </div>

      {reportOpen && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-red-700">Why are you flagging this?</p>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Pick a reason…</option>
            <option value="spam">Spam</option>
            <option value="scam">Scam or suspicious</option>
            <option value="inappropriate">Inappropriate / offensive</option>
            <option value="duplicate">Duplicate of another listing</option>
            <option value="other">Other</option>
          </select>
          <textarea value={details} onChange={e => setDetails(e.target.value)}
            placeholder="Details (optional)" rows={2} maxLength={500}
            className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-xs resize-none" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setReportOpen(false)} disabled={reporting}
              className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-900">Cancel</button>
            <button onClick={submitReport} disabled={reporting || !reason}
              className="text-xs px-4 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-bold rounded-lg transition-colors">
              {reporting ? 'Sending…' : 'Submit report'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
