'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import posthog from 'posthog-js'

export type RSVPStatus = 'idle' | 'joined' | 'pending' | 'waitlisted' | 'loading' | 'error'

export function useRSVP(eventId: string) {
  const { isLoggedIn } = useAuth()
  const router = useRouter()
  const [status,   setStatus]   = useState<RSVPStatus>('loading')
  const [position, setPosition] = useState<number | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [checked,  setChecked]  = useState(false)

  useEffect(() => {
    if (!isLoggedIn) { setStatus('idle'); setChecked(true); return }
    apiFetch(`/app/api/events/${eventId}/rsvp`)
      .then(r => r.json())
      .then(d => {
        if (d.attending)  setStatus('joined')
        else if (d.pending)    setStatus('pending')
        else if (d.waitlisted) setStatus('waitlisted')
        else setStatus('idle')
        setPosition(d.position ?? null)
        setChecked(true)
      })
      .catch(() => { setStatus('idle'); setChecked(true) })
  }, [eventId, isLoggedIn])

  async function join(stealth = false) {
    if (!isLoggedIn) { router.push('/login'); return }
    setLoading(true)
    try {
      const res  = await apiFetch(`/app/api/events/${eventId}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stealth }),
      })
      const data = await res.json()
      if (!res.ok) {
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

  return { status, position, loading, checked, join, leave }
}
