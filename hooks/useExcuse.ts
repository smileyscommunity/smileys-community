'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'

// The morning-after waiver, for both door screens (/host/checkin and
// /admin/checkin): a guest who wasn't scanned but shouldn't count as a
// no-show (cancelled on WhatsApp, had a reason). POST ../checkin/excuse;
// who may and when is decided there (lib/attendanceCloseOut canExcuse).

type ExcuseRow = { userId: string; checkedIn: boolean; attendance?: string; exempt?: boolean }

/** Offered on a row nobody scanned and who isn't running the event, once it has started. */
export function excusable(a: ExcuseRow, started: boolean): boolean {
  return started && !a.checkedIn && !a.exempt && a.attendance !== 'attended'
}

export function useExcuse<A extends ExcuseRow>({ eventId, setAttendees, onError }: {
  eventId:      string
  setAttendees: Dispatch<SetStateAction<A[]>>
  /** Where a failure is shown. Defaults to a toast. */
  onError?:     (message: string) => void
}) {
  const [excusing, setExcusing] = useState<string | null>(null)
  const fail = (message: string) => onError ? onError(message) : toast.error(message)

  async function excuse(userId: string, next: boolean) {
    if (!eventId || excusing) return
    setExcusing(userId)
    try {
      const res = await fetch(`/app/api/events/${eventId}/checkin/excuse`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, excused: next }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { fail(typeof d?.error === 'string' ? d.error : "Couldn't save that. Please try again."); return }
      if (typeof d?.attendance === 'string') {
        setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, attendance: d.attendance } : a))
      }
    } catch {
      fail('No connection — nothing was changed.')
    } finally {
      setExcusing(null)
    }
  }

  return { excusing, excuse }
}
