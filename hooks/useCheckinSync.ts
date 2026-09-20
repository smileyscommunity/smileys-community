'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  enqueue, dequeue, pendingFor, freshOnly, flushQueue, loadQueue, saveQueue, patchCheckin,
  type QueuedCheckin, type SendOutcome,
} from '@/lib/checkinQueue'

// The door's line to the server when the signal is bad (lib/checkinQueue).
//
// `send` is what a tap calls. 'saved' and 'offline' both leave the row as
// tapped — an offline tap is kept on the device and replayed on reconnect,
// when the page comes back into view, and every 15 seconds. 'refused' means
// roll the row back and show the reason. `onRefused` hears about a queued tap
// the server turned down on replay, so the page can undo that row too.

const RETRY_EVERY_MS = 15_000

export function useCheckinSync(
  eventId: string,
  onRefused?: (item: QueuedCheckin, error: string) => void,
) {
  const [pending, setPending] = useState<QueuedCheckin[]>([])
  const flushing     = useRef(false)
  const onRefusedRef = useRef(onRefused)
  onRefusedRef.current = onRefused

  // Always re-read storage before changing it: another tab at the same door
  // may have written since.
  const update = useCallback((change: (queue: QueuedCheckin[]) => QueuedCheckin[]) => {
    const next = change(freshOnly(loadQueue()))
    saveQueue(next)
    setPending(pendingFor(next, eventId))
  }, [eventId])

  const flush = useCallback(async () => {
    if (!eventId || flushing.current) return
    const items = pendingFor(freshOnly(loadQueue()), eventId)
    setPending(items)
    if (items.length === 0) return
    flushing.current = true
    try {
      const stillQueued = (item: QueuedCheckin) =>
        loadQueue().some(q => q.eventId === item.eventId && q.userId === item.userId && q.at === item.at)
      const { sent, refused } = await flushQueue(items, item =>
        // A newer tap for the same person was sent directly meanwhile: this one is stale.
        stillQueued(item) ? patchCheckin(item.eventId, item.userId, item.checkedIn, item.at, item.cardToken) : Promise.resolve<SendOutcome>({ kind: 'saved' }))
      const done = [...sent, ...refused.map(r => r.item)]
      update(queue => queue.filter(q => !done.some(d => d.eventId === q.eventId && d.userId === q.userId && d.at === q.at)))
      for (const r of refused) onRefusedRef.current?.(r.item, r.error)
    } finally {
      flushing.current = false
    }
  }, [eventId, update])

  useEffect(() => {
    if (!eventId) { setPending([]); return }
    flush()
    const onOnline  = () => { flush() }
    const onVisible = () => { if (document.visibilityState === 'visible') flush() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(onOnline, RETRY_EVERY_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [eventId, flush])

  // `cardToken` is the raw scanned code, carried through to the server and
  // kept with a queued tap so an offline scan still proves itself on replay.
  const send = useCallback(async (userId: string, checkedIn: boolean, cardToken?: string): Promise<SendOutcome> => {
    const outcome = await patchCheckin(eventId, userId, checkedIn, undefined, cardToken)
    if (outcome.kind === 'offline') update(queue => enqueue(queue, { eventId, userId, checkedIn, at: Date.now(), ...(cardToken ? { cardToken } : {}) }))
    // Saved or refused, this tap supersedes anything still queued for them.
    else update(queue => dequeue(queue, eventId, userId))
    return outcome
  }, [eventId, update])

  return { pending, send, flush }
}
