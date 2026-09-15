import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  enqueue, dequeue, pendingFor, freshOnly, applyPending, flushQueue, patchCheckin, loadQueue, saveQueue,
  CHECKIN_QUEUE_KEY, CHECKIN_QUEUE_MAX_AGE_MS, type QueuedCheckin, type SendOutcome,
} from '@/lib/checkinQueue'

// Check-ins made without signal wait on the device and replay later; a tap
// the server refuses is never retried. These pin the queue's rules.

const tap = (userId: string, checkedIn = true, eventId = 'e1', at = 1_000): QueuedCheckin => ({ eventId, userId, checkedIn, at })

afterEach(() => { vi.unstubAllGlobals() })

describe('queue rules', () => {
  it('keeps only the latest tap per person per event', () => {
    let q = enqueue([], tap('a', true, 'e1', 1))
    q = enqueue(q, tap('b', true, 'e1', 2))
    q = enqueue(q, tap('a', false, 'e1', 3))
    q = enqueue(q, tap('a', true, 'e2', 4))
    expect(q).toEqual([tap('b', true, 'e1', 2), tap('a', false, 'e1', 3), tap('a', true, 'e2', 4)])
    expect(pendingFor(q, 'e1').map(x => x.userId)).toEqual(['b', 'a'])
    expect(dequeue(q, 'e1', 'a')).toEqual([tap('b', true, 'e1', 2), tap('a', true, 'e2', 4)])
  })

  it('drops taps too old to replay', () => {
    const now = 10 * CHECKIN_QUEUE_MAX_AGE_MS
    expect(freshOnly([tap('old', true, 'e1', now - CHECKIN_QUEUE_MAX_AGE_MS - 1), tap('new', true, 'e1', now - 1)], now)
      .map(x => x.userId)).toEqual(['new'])
  })

  it('lays unsent taps over a freshly loaded roster', () => {
    const rows = [
      { userId: 'a', checkedIn: false, attendance: 'no_show' },
      { userId: 'b', checkedIn: true,  attendance: 'attended' },
      { userId: 'c', checkedIn: false, attendance: 'unknown' },
    ]
    expect(applyPending(rows, [tap('a', true), tap('b', false)])).toEqual([
      { userId: 'a', checkedIn: true,  attendance: 'attended' },
      { userId: 'b', checkedIn: false, attendance: 'unknown' },
      { userId: 'c', checkedIn: false, attendance: 'unknown' },
    ])
  })
})

describe('flushQueue', () => {
  const outcomes = (...list: SendOutcome[]) => { let i = 0; return vi.fn(async () => list[i++]) }

  it('sends in order and stops at the first network failure, keeping the rest', async () => {
    const send = outcomes({ kind: 'saved' }, { kind: 'offline' }, { kind: 'saved' })
    const r = await flushQueue([tap('a'), tap('b'), tap('c')], send)
    expect(r.sent.map(x => x.userId)).toEqual(['a'])
    expect(r.remaining.map(x => x.userId)).toEqual(['b', 'c'])
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('drops and reports a refusal instead of retrying it', async () => {
    const r = await flushQueue([tap('a'), tap('b')], outcomes({ kind: 'refused', error: 'settled' }, { kind: 'saved' }))
    expect(r.refused).toEqual([{ item: tap('a'), error: 'settled' }])
    expect(r.sent.map(x => x.userId)).toEqual(['b'])
    expect(r.remaining).toEqual([])
  })
})

describe('patchCheckin', () => {
  it('reads a browser that knows it is offline as offline without trying', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('fetch', fetchMock)
    expect(await patchCheckin('e1', 'a', true)).toEqual({ kind: 'offline' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads a request that never reached the server as offline', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await patchCheckin('e1', 'a', true)).toEqual({ kind: 'offline' })
  })

  it('passes the server\'s reason through on a refusal, and saved on success', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Attendance is settled' }), { status: 409 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })))
    expect(await patchCheckin('e1', 'a', true)).toEqual({ kind: 'refused', error: 'Attendance is settled' })
    expect(await patchCheckin('e1', 'a', true)).toEqual({ kind: 'saved' })
  })
})

describe('storage', () => {
  const memory = () => {
    const store = new Map<string, string>()
    return {
      getItem:    (k: string) => store.get(k) ?? null,
      setItem:    (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      store,
    }
  }

  it('round-trips, clears when empty, and ignores malformed entries', () => {
    const ls = memory()
    vi.stubGlobal('localStorage', ls)
    saveQueue([tap('a')])
    expect(loadQueue()).toEqual([tap('a')])
    ls.setItem(CHECKIN_QUEUE_KEY, JSON.stringify([tap('b'), { userId: 'x' }, null]))
    expect(loadQueue()).toEqual([tap('b')])
    saveQueue([])
    expect(ls.store.has(CHECKIN_QUEUE_KEY)).toBe(false)
  })

  it('never throws when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(loadQueue()).toEqual([])
    expect(() => saveQueue([tap('a')])).not.toThrow()
  })
})
