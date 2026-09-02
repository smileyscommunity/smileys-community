'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { confirmToast } from '@/lib/confirmToast'
import posthog from 'posthog-js'

export type RSVPStatus = 'idle' | 'joined' | 'pending' | 'waitlisted' | 'loading' | 'error'

// The no-show gate as the server reports it (see lib/noShow.gateErrorBody).
// `red_card_blocked` renders a paused button; `yellow_ack_required` is
// handled on the tap — a confirmation, then the request is retried with it.
export type RSVPGate =
  | { ok: true }
  | { ok: false; code: 'red_card_blocked'; restrictionEndsAt: string; appealDeadlineAt: string | null }
  | { ok: false; code: 'yellow_ack_required'; cardId: string }

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function useRSVP(eventId: string, initialStatus?: 'joined' | 'pending' | 'waitlisted' | null) {
  const { isLoggedIn } = useAuth()
  const router = useRouter()
  // Callers that already know the member's status (the events grid fetches
  // /events/attending ONCE for the whole page) seed it here — otherwise
  // every card independently hits /rsvp and flashes 'loading', which on a
  // 24-card grid meant 24 requests and 24 gray "…" buttons per visit.
  const seeded = initialStatus !== undefined
  const [status,   setStatus]   = useState<RSVPStatus>(seeded ? initialStatus ?? 'idle' : 'loading')
  const [position, setPosition] = useState<number | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [checked,  setChecked]  = useState(seeded)
  const [gate,     setGate]     = useState<RSVPGate>({ ok: true })

  useEffect(() => {
    if (seeded) return
    if (!isLoggedIn) { setStatus('idle'); setChecked(true); return }
    apiFetch(`/app/api/events/${eventId}/rsvp`)
      .then(r => r.json())
      .then(d => {
        if (d.attending)  setStatus('joined')
        else if (d.pending)    setStatus('pending')
        else if (d.waitlisted) setStatus('waitlisted')
        else setStatus('idle')
        setPosition(d.position ?? null)
        if (d.gate) setGate(d.gate)
        setChecked(true)
      })
      .catch(() => { setStatus('idle'); setChecked(true) })
  }, [eventId, isLoggedIn, seeded])

  async function join(stealth = false, acknowledgeNoShow = false) {
    if (!isLoggedIn) { router.push('/login'); return }
    setLoading(true)
    try {
      const res  = await apiFetch(`/app/api/events/${eventId}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stealth, acknowledgeNoShow }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Yellow card: the server wants an explicit "I'll actually come"
        // before it writes the RSVP. Ask, and retry with the confirmation —
        // the retry is what records the acknowledgement.
        if (data.code === 'yellow_ack_required' && !acknowledgeNoShow) {
          setLoading(false)
          const yes = await confirmToast(
            "You missed an event you'd RSVP'd to. Spots are limited — please only join if you'll actually come.",
            { confirmLabel: "I'll actually come", cancelLabel: 'Not this time' },
          )
          if (yes) return join(stealth, true)
          posthog.capture('event_rsvp_declined_after_warning', { event_id: eventId })
          return
        }
        if (data.code === 'red_card_blocked') {
          setGate({ ok: false, code: 'red_card_blocked', restrictionEndsAt: data.restrictionEndsAt, appealDeadlineAt: data.appealDeadlineAt ?? null })
          posthog.capture('event_rsvp_blocked', { event_id: eventId })
          toast.error(`RSVPs are paused until ${fmtDay(data.restrictionEndsAt)}`)
          return
        }
        posthog.capture('event_rsvp_failed', { event_id: eventId, status_code: res.status, reason: data.error })
        toast.error(data.error ?? 'Could not join')
        return
      }
      
      if (data.status === 'waitlisted') {
        setStatus('waitlisted')
        setPosition(data.position)
        posthog.capture('event_waitlist_joined', { event_id: eventId, waitlist_position: data.position, stealth })
        toast(`Added to waitlist — position #${data.position}`)
        navigator.vibrate?.([40, 60, 40])
      } else if (data.status === 'pending') {
        setStatus('pending')
        posthog.capture('event_rsvp_joined', { event_id: eventId, status: 'pending', stealth })
        toast('Request submitted — awaiting approval')
        navigator.vibrate?.(40)
      } else {
        setStatus('joined')
        posthog.capture('event_rsvp_joined', { event_id: eventId, status: 'approved', stealth })
        toast.success("You're in! 🎉")
        navigator.vibrate?.([50, 30, 80])
        router.refresh()
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function leave() {
    setLoading(true)
    try {
      const res = await apiFetch(`/app/api/events/${eventId}/rsvp`, { method: 'DELETE' })
      if (!res.ok) {
        posthog.capture('event_rsvp_cancel_failed', { event_id: eventId, status_code: res.status, previous_status: status })
        toast.error('Could not cancel')
        return
      }

      posthog.capture('event_rsvp_cancelled', { event_id: eventId, previous_status: status })
      setStatus('idle')
      setPosition(null)
      toast('Registration cancelled')
      router.refresh()
    } catch {
      toast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return { status, position, loading, checked, join, leave, gate }
}
