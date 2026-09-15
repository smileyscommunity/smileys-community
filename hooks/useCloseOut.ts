'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { vibrate } from '@/lib/checkin'
import { restToClose } from '@/lib/attendanceCloseOut'

// "Mark the rest as no-show" and its undo, for both door screens
// (/host/checkin and /admin/checkin), so the two can't drift on wording or
// on who counts. The rule for "the rest" lives in lib/attendanceCloseOut,
// next to the route that applies it (app/api/events/[id]/checkin/close-out).

type CloseOutRow = { userId: string; checkedIn: boolean; attendance?: string; exempt?: boolean }

export function useCloseOut<A extends CloseOutRow>({ eventId, attendees, setAttendees, onError }: {
  eventId:      string
  attendees:    A[]
  setAttendees: Dispatch<SetStateAction<A[]>>
  /** Where a failure is shown. Defaults to a toast. */
  onError?:     (message: string) => void
}) {
  const [closing, setClosing] = useState(false)
  const rest        = restToClose(attendees)
  const noShowCount = attendees.filter(a => !a.checkedIn && a.attendance === 'no_show').length

  function fail(message: string) {
    vibrate.error()
    if (onError) onError(message)
    else toast.error(message)
  }

  async function undo(userIds: string[]) {
    try {
      const res = await fetch(`/app/api/events/${eventId}/checkin/close-out`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(typeof d?.error === 'string' ? d.error : "Couldn't undo. Please try again.")
        return
      }
      setAttendees(prev => prev.map(a =>
        userIds.includes(a.userId) && !a.checkedIn && a.attendance === 'no_show' ? { ...a, attendance: 'unknown' } : a))
      toast.success('No-shows cleared')
    } catch {
      toast.error('No connection — nothing was undone.')
    }
  }

  // End of the night: everyone not checked in and not running the event is a
  // no-show, because the host says so — never because a scan is missing.
  async function markRest() {
    const n = rest.length
    if (n === 0 || closing || !eventId) return
    const roomCheckedIn = attendees.filter(a => a.checkedIn && !a.exempt).length
    const ok = await confirmToast(
      roomCheckedIn === 0
        ? `Nobody is checked in yet. Mark all ${n} as no-show? Only if the room really was empty.`
        : `Mark the ${n} ${n === 1 ? 'person' : 'people'} not checked in as no-show? Anyone who turns up later can still be checked in.`,
      { confirmLabel: 'Mark no-show' },
    )
    if (!ok) return
    setClosing(true)
    try {
      const res = await fetch(`/app/api/events/${eventId}/checkin/close-out`, { method: 'POST', credentials: 'include' })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        fail(typeof d?.error === 'string' ? d.error : "Couldn't mark no-shows. Please try again.")
        return
      }
      const marked: string[] = Array.isArray(d?.marked) ? d.marked : []
      setAttendees(prev => prev.map(a => marked.includes(a.userId) ? { ...a, attendance: 'no_show' } : a))
      if (marked.length > 0) {
        toast.success(`${marked.length} marked as no-show`, {
          duration: 10_000,
          action: { label: 'Undo', onClick: () => { undo(marked) } },
        })
      }
    } catch {
      fail('No connection — no-shows were not marked. Please try again.')
    } finally {
      setClosing(false)
    }
  }

  return { rest, noShowCount, closing, markRest }
}
