import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { joinBlock, joinBlockLabel } from '@/lib/eventJoinState'
import { fromWallClockInTz } from '@/lib/cityTime'

const read = (p: string) => readFileSync(p, 'utf-8')

// Item 90 — member-facing event UI.

describe('90a. joinBlock mirrors the RSVP route', () => {
  const IST = 'Europe/Istanbul'
  const TBS = 'Asia/Tbilisi'
  const at = (wall: string, tz = IST) => fromWallClockInTz(wall, tz)
  const ev = (over: Record<string, unknown> = {}) =>
    ({ date: '2026-09-20', time: '19:00', endTime: '22:00', status: 'published', ...over })

  it('is open before the start', () => {
    expect(joinBlock(ev(), IST, at('2026-09-20T18:00'))).toBeNull()
    expect(joinBlock(ev(), IST, at('2026-09-19T12:00'))).toBeNull()
  })
  it('is started from the start until the end', () => {
    expect(joinBlock(ev(), IST, at('2026-09-20T19:00'))).toBe('started')
    expect(joinBlock(ev(), IST, at('2026-09-20T21:59'))).toBe('started')
  })
  it('is ended from the end, and on any later day', () => {
    expect(joinBlock(ev(), IST, at('2026-09-20T22:00'))).toBe('ended')
    expect(joinBlock(ev(), IST, at('2026-09-21T09:00'))).toBe('ended')
  })
  it('treats a status other than published as closed, cancelled first', () => {
    expect(joinBlock(ev({ status: 'cancelled' }), IST, at('2026-09-19T12:00'))).toBe('cancelled')
    expect(joinBlock(ev({ status: 'postponed' }), IST, at('2026-09-19T12:00'))).toBe('postponed')
    expect(joinBlock(ev({ status: 'archived' }), IST, at('2026-09-19T12:00'))).toBe('closed')
    // Legacy rows with no status read as published, like the rest of the app.
    expect(joinBlock(ev({ status: undefined }), IST, at('2026-09-19T12:00'))).toBeNull()
  })
  it('a TBA time stays open all day and ends at 23:59', () => {
    const tba = ev({ time: 'TBA', endTime: null })
    expect(joinBlock(tba, IST, at('2026-09-20T20:00'))).toBeNull()
    expect(joinBlock(tba, IST, at('2026-09-20T23:59'))).toBe('ended')
  })
  it('judges on the event city\'s clock', () => {
    // 18:30 in Istanbul is 19:30 in Tbilisi — a Tbilisi 19:00 event has begun.
    const now = at('2026-09-20T18:30', IST)
    expect(joinBlock(ev(), IST, now)).toBeNull()
    expect(joinBlock(ev(), TBS, now)).toBe('started')
  })
  it('a garbled date answers like the route: never "started", but the day compare still applies', () => {
    // '2026/09/20' sorts after today's '2026-09-19' → not a past day, and the
    // start/end math is skipped rather than reading Invalid Date as started.
    expect(joinBlock(ev({ date: '2026/09/20' }), IST, at('2026-09-20T20:00'))).toBeNull()
    // '20/09/2026' sorts before it, exactly as `event.date < eventToday` does
    // in the RSVP route ("already happened") — the button says the same.
    expect(joinBlock(ev({ date: '20/09/2026' }), IST, at('2026-09-19T12:00'))).toBe('ended')
  })
  it('labels honestly', () => {
    expect(joinBlockLabel('ended')).toBe('Event ended')
    expect(joinBlockLabel('cancelled')).toBe('Cancelled')
    expect(joinBlockLabel(null)).toBeNull()
  })
})

describe('90a. the card and the page use it', () => {
  it('the card disables and relabels Join from joinBlock', () => {
    const src = read('components/EventCard.tsx')
    expect(src).toContain('const block        = joinBlock(event, timeZone)')
    expect(src).toContain("disabled={!!block || status !== 'idle'}")
    expect(src).toMatch(/\{blockedLabel\s+\? blockedLabel :/)
    expect(src).toMatch(/if \(block\) return/)
  })
  it('the page computes the label on the event city clock and passes it to both RSVP buttons', () => {
    const page = read('app/events/[id]/page.tsx')
    expect(page).toContain('const closedLabel = joinBlockLabel(joinBlock(event, eventTz))')
    expect(page.match(/closedLabel=\{closedLabel\}/g)).toHaveLength(2)
    const btn = read('components/RSVPButton.tsx')
    expect(btn).toMatch(/if \(closedLabel && \(status === 'idle' \|\| status === 'error' \|\| status === 'loading'\)\)/)
  })
  it('card callers that know the city pass its zone', () => {
    expect(read('app/[city]/events/page.tsx')).toContain('<EventCard key={e.id} event={e} timeZone={city.timezone} />')
    expect(read('app/events/EventsClient.tsx').match(/timeZone=\{tz\}/g)).toHaveLength(2)
    expect(read('app/[city]/sections/Events.tsx')).toContain('timeZone={city.timezone}')
  })
})

describe('90b. the card says "On waitlist"', () => {
  it('renders the waitlisted status it is seeded with', () => {
    const src = read('components/EventCard.tsx')
    expect(src).toContain("status === 'waitlisted' ? '⏳ On waitlist' :")
    // Seeded once per page from /events/attending, which returns waitlisted rows.
    expect(read('app/events/EventsClient.tsx')).toContain("a.status === 'waitlisted' ? 'waitlisted'")
  })
})

describe('90c. opening an event does not jump to the discussion', () => {
  const src = read('components/EventMessages.tsx')
  it('no longer scrolls the page via a sentinel', () => {
    expect(src).not.toContain('bottomRef')
    expect(src).toContain('el.scrollTop = el.scrollHeight')
  })
  it('moves the page only for #discussion or ?comment=', () => {
    expect(src).toContain("hash === '#discussion' || new URLSearchParams(search).has('comment')")
    expect(src).toContain('id="discussion"')
  })
})

describe('90d. the discussion is honest with non-attendees', () => {
  it('the page passes the messages route\'s own rule (no moderator)', () => {
    const page = read('app/events/[id]/page.tsx')
    expect(page).toContain("const canUseDiscussion = isAdmin || isHost || cohostIds.includes(session.id) || myAttendance?.status === 'approved'")
    const route = read('app/api/events/[id]/messages/route.ts')
    expect(route).toContain("const allowed = event.hostId === session.id || !!cohost || attendee?.status === 'approved'")
  })
  it('hides the composer and explains, including on a 403 read', () => {
    const src = read('components/EventMessages.tsx')
    expect(src).toContain('Discussion is for attendees')
    expect(src).toMatch(/if \(r\.status === 401 \|\| r\.status === 403\) \{ setMessages\(\[\]\); setForbidden\(true\); return \}/)
    expect(src).toMatch(/isLoggedIn && forbidden \? \(/)
  })
})

describe('90e. "View all events" on a city page stays in that city', () => {
  it('EventTabs takes the link, the city section passes its entry link', () => {
    expect(read('components/EventTabs.tsx')).toContain('<a href={allHref} className="btn-secondary md:btn-ghost">View all events</a>')
    expect(read('app/[city]/sections/Events.tsx')).toContain("allHref={enter('events')}")
    expect(read('app/[city]/page.tsx')).toContain('<Events city={city} tabEvents={tabEvents} eventWindow={eventWindow} enter={enter} />')
  })
})

describe('90f. the QR scanner releases the camera', () => {
  const src = read('components/QRScanner.tsx')
  it('stops a stream that resolves after close', () => {
    expect(src).toContain('if (!active) { s.getTracks().forEach(t => t.stop()); return }')
  })
  it('uses per-run state and returns stop as the cleanup', () => {
    expect(src).not.toContain('activeRef.current')
    expect(src).toContain('return stop')
    expect(src).toContain('cancelAnimationFrame(frame)')
  })
  it('every close button stops the camera first', () => {
    expect(src).not.toContain('onClick={onClose}')
    expect(src).toMatch(/function close\(\) \{\s*stopRef\.current\(\)\s*onClose\(\)/)
  })
})

describe('90g. event deletes say when they fail', () => {
  it('discussion delete checks res.ok and toasts the server error', () => {
    const src = read('components/EventMessages.tsx')
    expect(src).toContain("toast.error(d?.error ?? 'Could not delete the message')")
    expect(src).not.toContain('if (res.ok) setMessages(prev => prev.filter')
  })
  it('review delete does too', () => {
    const src = read('components/EventReviews.tsx')
    expect(src).toContain("toast.error(d?.error ?? 'Could not delete your review')")
    expect(src).not.toContain('if (res.ok) setReviews(')
  })
})
