import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

// Postponing a live event told only the approved seats, and only through the
// bell (plus push, if they had it). Pending requests and the waitlist heard
// nothing, and no one got an email, unlike a cancellation.
describe('postponing an event tells everyone waiting on it', () => {
  const route = read('app/api/admin/events/[id]/route.ts')
  const start = route.indexOf("event.status === 'postponed'")
  const block = route.slice(start, route.indexOf('if (cancelling) {', start))

  it('reads seats and pending requests, and the waitlist', () => {
    expect(block).toMatch(/eventAttendee\.findMany\(\{\s*where:\s*\{ eventId: id, \.\.\.activeAttendeeWhere \}/)
    expect(block).toMatch(/waitlistEntry\.findMany\(\{ where: \{ eventId: id \}/)
  })

  it('emails each of them, as a cancellation does, and logs failures', () => {
    expect(block).toMatch(/sendEventPostponedEmail\(/)
    expect(block).toMatch(/recordEmailFailure\(\{ helper: 'sendEventPostponedEmail'/)
    expect(block).toMatch(/createNotification\(userId, 'event_updated', 'Event postponed/)
  })

  it('sends one message per person, a seat outranking a waitlist place', () => {
    const wl = block.indexOf("role: 'waitlist'")
    const seat = block.indexOf("'going' : 'pending'")
    expect(wl).toBeGreaterThan(-1)
    expect(seat).toBeGreaterThan(wl) // written after, so it wins the Map key
  })

  it('releases nothing: postponing is not cancelling', () => {
    expect(block).not.toMatch(/updateMany|deleteMany/)
  })

  it('the email says what each person keeps', () => {
    const email = read('lib/email.ts')
    expect(email).toMatch(/export async function sendEventPostponedEmail\(/)
    for (const role of ['going', 'pending', 'waitlist']) expect(email).toMatch(new RegExp(`${role}:\\s+['"]`))
  })
})

// A postponed event dropped off the feed and club pages entirely, so people
// who had seen it thought it was gone. It now lists like a cancelled one,
// stamped, while showcases, digests and JSON-LD leave both out.
describe('postponed events stay visible, stamped', () => {
  it('the feed and club lists include postponed next to cancelled', () => {
    const db = read('lib/db.ts')
    expect(db).not.toMatch(/status: \{ in: \['published', 'cancelled'\] \}/)
    expect(db).not.toMatch(/status: \{ in: \['published', 'archived', 'cancelled'\] \}/)
    expect((db.match(/'cancelled', 'postponed'\]/g) ?? []).length).toBe(4)
  })

  it('the card stamps it and colors its closed button', () => {
    const card = read('components/EventCard.tsx')
    expect(card).toMatch(/const isPostponed = event\.status === 'postponed'/)
    expect(card).toMatch(/\{isPostponed && \(/)
    expect(card).toMatch(/>\s*Postponed\s*</)
  })

  it('isOffCalendar is cancelled or postponed, nothing else', async () => {
    const { isOffCalendar } = await import('@/lib/eventJoinState')
    expect(isOffCalendar({ status: 'cancelled' })).toBe(true)
    expect(isOffCalendar({ status: 'postponed' })).toBe(true)
    for (const s of ['published', 'archived', null, undefined]) expect(isOffCalendar({ status: s })).toBe(false)
  })

  it.each([
    'app/page.tsx', 'app/(member)/clubs/[slug]/page.tsx', 'app/[city]/data.ts',
    'app/admin/newsletter/page.tsx', 'app/[city]/experiences/page.tsx', 'lib/students.ts', 'lib/remoteWork.ts',
  ])('%s leaves off-calendar events out with the shared rule', (file) => {
    const src = read(file)
    expect(src).toMatch(/isOffCalendar\(e\)/)
    expect(src).not.toMatch(/e\.status [!=]== 'cancelled'/)
  })
})
