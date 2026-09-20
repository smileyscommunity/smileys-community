import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// The member card and the door, from the two ends that actually break:
// a card asked to open with no network, and a scan whose answer has to be
// the truth about the person holding it.
//
// The components are read rather than rendered — vitest runs in node against
// a tsconfig with `jsx: preserve`, so a .tsx import can't be transformed here
// (the same reason every other component test in this suite reads source).
// What can be executed is executed: the token this device keeps and the parse
// the scanner runs are plain functions and are tested as such.

const read = (p: string) => readFileSync(p, 'utf8')

import { parseCheckinQR } from '@/lib/checkin'
import { hasCardShape, readCardTokenExp } from '@/lib/cardTokenShape'
import {
  CARD_TOKEN_KEY, cacheCardProfile, cacheCardToken, cardTokenExpired, loadCardToken,
  readCachedCardProfile, readCachedCardToken,
} from '@/lib/memberCard'

describe('the card owes the network nothing', () => {
  const page = read('app/(member)/card/page.tsx')
  const card = read('components/DigitalCard.tsx')

  it('draws the member from the session the app already holds', () => {
    // No spinner gate in front of the card: the old page rendered a skeleton
    // until /api/auth/me answered, which at a door in a basement is for ever.
    expect(page).toContain('const { user } = useAuth()')
    expect(page).toMatch(/id:\s+user\.id/)
    expect(page).toMatch(/membershipType:\s+user\.membershipType/)
    expect(page).toMatch(/joinedAt:\s+user\.joinedAt/)
    expect(page).not.toContain('setLoading')
  })

  it('never invents a membership tier', () => {
    // 'member' is not one of lib/membership's tiers, and seeding it stripped
    // a paying member's badge whenever the refresh failed.
    expect(page).not.toContain("membershipType: 'member'")
    expect(page).toContain('.catch(')
    expect(page).toContain('setStale(true)')
  })

  it('says the refresh failed instead of showing a confident wrong card', () => {
    expect(page).toContain("Couldn&apos;t refresh your details")
  })

  it('describes what the code actually does', () => {
    // There is no membership-verification flow — only check-in for an event
    // you have joined. All three old lines claimed otherwise.
    for (const lie of [/verify your membership/i, /instant check-in/i, /Show this at events/i]) {
      expect(page).not.toMatch(lie)
      expect(card).not.toMatch(lie)
    }
    expect(page).toContain("isn&apos;t a pass or a membership check")
  })

  it('takes its name and initials from the shared helpers', () => {
    // '🙂 Nate' through `w[0]` is a lone surrogate — a broken glyph on the card.
    expect(card).toContain("import { formatName, getInitials, resolveImageUrl } from '@/lib/data'")
    expect(card).toContain('const initials = getInitials(user.name)')
    expect(card).toContain('const name     = formatName(user.name)')
    expect(card).not.toContain("split(' ').map(w => w[0])")
  })

  it('dates the join year by the city clock, not the device', () => {
    expect(card).toContain('dayInTz(joined, tz).slice(0, 4)')
    expect(card).not.toContain('getFullYear()')
  })

  it('prints the member id as it really is, selectable, and honestly labelled', () => {
    expect(card).toContain('Member ID (for support)')
    expect(card).toContain('select-text')
    expect(card).toContain('{user.id}')
    expect(card).not.toContain('slice(-8).toUpperCase()')
  })

  it('drops the unbuilt save-as-image and the prop nothing read', () => {
    expect(card).not.toContain('cardRef')
    expect(card).not.toContain('interests')
  })

  it('renders the QR big enough to read, and at the screen\'s real pixels', () => {
    const qr = read('components/QRCode.tsx')
    expect(qr).toContain('window.devicePixelRatio')
    expect(qr).toContain('Math.round(size * dpr)')
    expect(qr).toContain('role="img"')
    expect(qr).toContain('aria-label={label}')
    expect(card).toContain('const CARD_QR  = 140')
  })

  it('keeps the screen awake while the code is full screen, where it can', () => {
    expect(card).toContain("if (!('wakeLock' in navigator)) return")
    expect(card).toContain("navigator.wakeLock.request('screen')")
    expect(card).toContain("document.addEventListener('visibilitychange', onVisibility)")
    expect(card).toContain("document.removeEventListener('visibilitychange', onVisibility)")
  })

  it('asks again whether the code is dead, instead of answering once', () => {
    // `card.expired` is the answer from the moment the code loaded. The page
    // that matters is one left open overnight, where that answer is a day old.
    expect(page).toContain('const expired = !!card?.token && cardTokenExpired(card.token)')
    expect(page).toContain('const qrNote = expired')
    expect(page).not.toContain('card?.expired')
  })

  it('re-mints when the member comes back to it', () => {
    expect(page).toContain("window.addEventListener('focus', again)")
    expect(page).toContain("document.addEventListener('visibilitychange', again)")
    expect(page).toContain("window.removeEventListener('focus', again)")
    expect(page).toContain("document.removeEventListener('visibilitychange', again)")
    // Both loaders re-run, not just one: a stale profile and a dead code
    // arrive by the same route.
    expect(page).toContain('}, [user.id, freshen])')
  })

  it('draws the badge and the join year from cache when /me is unreachable', () => {
    // The layout's session carries no membershipType, joinedAt or
    // profilePhoto, so the offline fallback was initials and nothing else.
    expect(page).toContain('setCached(readCachedCardProfile(user.id))')
    expect(page).toContain('cacheCardProfile(user.id, d)')
    // Session → what this phone last saw → the live refresh.
    expect(page).toMatch(/\.\.\.\(cached \?\? \{\}\),\s*\n\s*\.\.\.\(profile \?\? \{\}\),/)
    // And it still admits the refresh failed.
    expect(page).toContain('setStale(true)')
    expect(page).toContain("Couldn&apos;t refresh your details")
  })
})

describe('one code, not three', () => {
  const myEvents = read('app/(member)/my-events/page.tsx')

  it('my-events shows the same signed card token', () => {
    expect(myEvents).not.toContain('smileys-checkin:')
    expect(myEvents).toContain("import { loadCardToken, type CardTokenState } from '@/lib/memberCard'")
    expect(myEvents).toContain('<QRCode value={card.token.token}')
  })

  it('my-events tries again after an open with no signal', () => {
    // A failed load resolves a truthy state holding `token: null`. Guarding
    // on the object treated that as an answer: "No code on this phone yet"
    // for the life of the page, however many times the modal was reopened.
    expect(myEvents).toContain("if (!qrEvent || card?.token || !user.id || user.id === 'guest') return")
    expect(myEvents).toContain('}, [qrEvent, card?.token, user.id])')
  })
})

describe('the token this device keeps', () => {
  let store: Record<string, string>
  const stubStorage = () => vi.stubGlobal('localStorage', {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  beforeEach(() => { store = {}; stubStorage() })
  afterEach(() => { vi.unstubAllGlobals() })

  const token = { token: 'smileys:card:u1.29000000.sig', expiresAt: '2026-09-21T10:00:00.000Z' }

  it('is only ever handed back to the member it belongs to', () => {
    cacheCardToken('u1', token)
    expect(readCachedCardToken('u1')).toEqual(token)
    // A shared phone: the next member signing in must not be holding u1's card.
    expect(readCachedCardToken('u2')).toBeNull()
  })

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => {},
    })
    expect(() => cacheCardToken('u1', token)).not.toThrow()
    expect(readCachedCardToken('u1')).toBeNull()
  })

  it('ignores anything that is not a stored token', () => {
    store[CARD_TOKEN_KEY] = '{"nope":1}'
    expect(readCachedCardToken('u1')).toBeNull()
    store[CARD_TOKEN_KEY] = 'not json'
    expect(readCachedCardToken('u1')).toBeNull()
  })

  it('knows when it is past its day', () => {
    expect(cardTokenExpired(token, Date.parse('2026-09-21T09:00:00.000Z'))).toBe(false)
    expect(cardTokenExpired(token, Date.parse('2026-09-21T11:00:00.000Z'))).toBe(true)
    expect(cardTokenExpired({ ...token, expiresAt: 'rubbish' })).toBe(true)
  })

  it('mints a fresh one when it can, and keeps it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => token })))
    stubStorage()
    expect(await loadCardToken('u1')).toEqual({ token, cached: false, expired: false })
    expect(readCachedCardToken('u1')).toEqual(token)
  })

  it('falls back to the kept one at a door with no signal, flagged', async () => {
    cacheCardToken('u1', token)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    stubStorage()
    expect(await loadCardToken('u1', Date.parse('2026-09-21T09:00:00.000Z')))
      .toEqual({ token, cached: true, expired: false })
    // Same code a day later: still shown, but the card has to say why it
    // won't scan rather than leave the member guessing at the door.
    expect(await loadCardToken('u1', Date.parse('2026-09-22T09:00:00.000Z')))
      .toEqual({ token, cached: true, expired: true })
  })

  it('keeps the card\'s display fields beside it, and only those', () => {
    cacheCardProfile('u1', {
      id: 'u1', name: 'Nate G.', color: '#f59e0b', profilePhoto: null,
      membershipType: 'supporter', joinedAt: '2024-03-01T00:00:00.000Z', neighborhood: 'Cihangir',
      // Everything else /me answers with stays out of storage.
      email: 'nate@example.com', phone: '+90...', role: 'admin',
    })
    expect(readCachedCardProfile('u1')).toEqual({
      name: 'Nate G.', color: '#f59e0b', profilePhoto: null,
      membershipType: 'supporter', joinedAt: '2024-03-01T00:00:00.000Z', neighborhood: 'Cihangir',
    })
    // A shared phone: the next member signing in is not handed this either.
    expect(readCachedCardProfile('u2')).toBeNull()
  })

  it('does not let the two halves overwrite each other', () => {
    // The token and the profile arrive from two different fetches.
    cacheCardToken('u1', token)
    cacheCardProfile('u1', { membershipType: 'supporter' })
    expect(readCachedCardToken('u1')).toEqual(token)
    expect(readCachedCardProfile('u1')).toEqual({ membershipType: 'supporter' })
    cacheCardToken('u1', { ...token, token: 'smileys:card:u1.29000001.sig' })
    expect(readCachedCardProfile('u1')).toEqual({ membershipType: 'supporter' })
  })

  it('has no profile to show on a device that never saw one', () => {
    expect(readCachedCardProfile('u1')).toBeNull()
    store[CARD_TOKEN_KEY] = 'not json'
    expect(readCachedCardProfile('u1')).toBeNull()
    cacheCardProfile('u1', null)
    expect(readCachedCardProfile('u1')).toBeNull()
  })

  it('has nothing to show on a device that never minted one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    stubStorage()
    expect(await loadCardToken('u1')).toEqual({ token: null, cached: false, expired: false })
  })
})

describe('what the scanner makes of a code', () => {
  it('reads the signed card, and carries the raw string for the server to check', () => {
    const raw = 'smileys:card:user123.29123456.aBcDeFgHiJkLmNoPqRsTuV'
    expect(parseCheckinQR(raw, 'e1')).toEqual({ userId: 'user123', cardToken: raw })
    // Whitespace off a scanner or a paste must not change what is verified.
    expect(parseCheckinQR(`  ${raw}\n`, 'e1')).toEqual({ userId: 'user123', cardToken: raw })
  })

  it('still reads the retired shapes, so the door can name who is holding one', () => {
    expect(parseCheckinQR('smileys:member:user123', 'e1'))
      .toEqual({ userId: 'user123', cardToken: 'smileys:member:user123' })
    expect(parseCheckinQR('smileys-checkin:e1:user123', 'e1'))
      .toEqual({ userId: 'user123', cardToken: 'smileys-checkin:e1:user123' })
    // Another event's code is not this event's code.
    expect(parseCheckinQR('smileys-checkin:e2:user123', 'e1')).toBeNull()
  })

  it('refuses anything else', () => {
    expect(parseCheckinQR('https://smileyscommunity.com', 'e1')).toBeNull()
    expect(parseCheckinQR('smileys:card:', 'e1')).toBeNull()
    expect(parseCheckinQR('smileys:member:', 'e1')).toBeNull()
    expect(parseCheckinQR('', 'e1')).toBeNull()
  })
})

describe('the shape of a card, without the secret', () => {
  const real = 'smileys:card:user123.29123456.aBcDeFgHiJkLmNoPqRsTuV'

  it('knows a card-shaped string from something that merely names someone', () => {
    expect(hasCardShape(real)).toBe(true)
    expect(hasCardShape(`  ${real}\n`)).toBe(true)
    // The whole point: these parse far enough to name a member, and must not
    // be taken for a card. Anyone can write either one.
    expect(hasCardShape('smileys:card:user123')).toBe(false)
    expect(hasCardShape('smileys:member:user123')).toBe(false)
    expect(hasCardShape('smileys-checkin:e1:user123')).toBe(false)
    // Right shape, wrong signature length — still not a card.
    expect(hasCardShape('smileys:card:user123.29123456.short')).toBe(false)
    expect(hasCardShape('smileys:card:user123.29123456.')).toBe(false)
    expect(hasCardShape('smileys:card:.29123456.aBcDeFgHiJkLmNoPqRsTuV')).toBe(false)
    expect(hasCardShape('https://smileyscommunity.com')).toBe(false)
    expect(hasCardShape('')).toBe(false)
  })

  it('says nothing about whether the signature is real', () => {
    // No secret lives in the browser. 22 characters of anything passes here;
    // the server's verifyCardToken is what refuses a forgery.
    expect(hasCardShape('smileys:card:user123.29123456.oooooooooooooooooooooo')).toBe(true)
  })

  it('reads when the code says it dies, in milliseconds', () => {
    // lib/cardToken writes the expiry in minutes to keep the QR small.
    expect(readCardTokenExp(real)).toBe(29123456 * 60_000)
    expect(readCardTokenExp(`  ${real}\n`)).toBe(29123456 * 60_000)
    expect(readCardTokenExp('smileys:member:user123')).toBeNull()
    expect(readCardTokenExp('smileys:card:user123.notanumber.aBcDeFgHiJkLmNoPqRsTuV')).toBeNull()
    expect(readCardTokenExp('smileys:card:user123.-5.aBcDeFgHiJkLmNoPqRsTuV')).toBeNull()
    expect(readCardTokenExp('smileys:card:user123')).toBeNull()
    expect(readCardTokenExp('')).toBeNull()
  })
})

describe('what the door is told', () => {
  const toast = read('components/ScanResultToast.tsx')
  const hook  = read('lib/checkin.ts')

  it('separates the waitlist and the unapproved from a stranger', () => {
    // All three used to read "Not registered for this event" — untrue for two
    // of them, and the host turned away someone who was registered.
    expect(toast).not.toContain('Not registered for this event')
    expect(toast).toContain('is on the waitlist — seat them from the list to check in')
    expect(toast).toContain('asked to join, not approved yet')
    expect(toast).toContain("This card isn't on tonight's list")
    expect(hook).toContain("if (attendee.status === 'waitlisted')")
    expect(hook).toContain("if (attendee.status === 'pending')")
  })

  it('tells a stale card apart from a fake one and from a retired shape', () => {
    expect(toast).toContain('Their card expired — ask them to reopen the app')
    expect(toast).toContain('Out-of-date card — ask them to reopen the app')
    expect(toast).toContain("That code isn't valid")
    expect(hook).toContain("if (code === 'card_expired')")
    expect(hook).toContain("if (code === 'card_invalid')")
    expect(hook).toContain("if (code === 'card_outdated')")
  })

  it('sends the scanned string so the server can refuse a forged one', () => {
    expect(hook).toContain('await send(userId, true, cardToken)')
    // And on the path with no queue behind it, which used to drop the token
    // and write an unverified check-in from whatever the camera read.
    expect(hook).toContain('await patchCheckin(eventId, userId, true, undefined, cardToken)')
    expect(hook).not.toContain('await patchCheckin(eventId, userId, true)')
  })

  it('calls an expired card at the door, not hours later from a pocket', () => {
    // With both phones offline the server's refusal arrives when the queue
    // drains — long after the host waved them in on a green toast.
    expect(hook).toContain('const exp = readCardTokenExp(cardToken)')
    expect(hook).toContain('if (exp !== null && exp <= Date.now()) {')
    // Before the roster look-up and before anything is queued.
    expect(hook).toMatch(/const exp = readCardTokenExp[\s\S]*const attendee = attendees\.find/)
    expect(hook).toContain("flash({ type: 'expired' })")
  })

  it('reads the code shape without dragging the signing code to the phone', () => {
    // lib/cardToken imports node's crypto: importing it here put 325 KB of
    // crypto-browserify on /host/checkin and /admin/checkin.
    expect(hook).toContain("from '@/lib/cardTokenShape'")
    expect(hook).not.toContain("from '@/lib/cardToken'")
  })
})

describe('the camera stays on', () => {
  it('a scan no longer tears the scanner down', () => {
    // Thirty people at the door was thirty camera cold-starts.
    expect(read('lib/checkin.ts')).not.toContain('setScanning(false)\n\n    const')
    const scanner = read('components/QRScanner.tsx')
    expect(scanner).toContain('const REPEAT_IGNORE_MS = 2000')
    expect(scanner).toContain('const repeat = value === lastValue && now - lastSeen < REPEAT_IGNORE_MS')
    expect(scanner).toContain('if (!repeat) onScanRef.current(value)')
  })

  it('an unknown card can be seated without leaving the scanner', () => {
    const host = read('app/host/checkin/page.tsx')
    expect(host).toContain('Seat as walk-in')
    expect(host).toContain('async function seatUnknownScan(userId: string, cardToken: string)')
  })

  it('seating a scan is still a scan — the code goes to the server', () => {
    const host = read('app/host/checkin/page.tsx')
    // The panel used to drop the scanned string and seat + check in through a
    // tokenless send, so a bare `smileys:card:<any member id>` with no
    // signature, or a retired screenshot, walked someone straight in.
    expect(host).toContain("hasCardShape(scanResult.cardToken)")
    expect(host).toContain('{ userId: scanResult.userId, cardToken: scanResult.cardToken }')
    expect(host).toContain('async function seatedWalkIn(userId: string, cardToken?: string)')
    expect(host).toContain('await toggleCheckin(userId, false, cardToken)')
    expect(host).toContain('await send(userId, next, cardToken)')
    expect(host).toContain('await seatedWalkIn(userId, cardToken)')
    // A host's own tap on the list still carries none — they are already
    // authorised and can see who is in front of them.
    expect(host).toContain('async function toggleCheckin(userId: string, current: boolean, cardToken?: string)')
  })

  it('the waitlist and the unapproved ride along without joining the room', () => {
    const host = read('app/host/checkin/page.tsx')
    const hook = read('lib/checkin.ts')
    // One definition, shared by both doors — the admin page never got its own.
    expect(hook).toContain('export function isSeated(a: { status?: string; listed?: boolean }): boolean')
    expect(hook).toContain("return a.listed ?? (a.status === undefined || a.status === 'approved')")
    expect(host).toContain("import { vibrate, useScanCheckin, isSeated } from '@/lib/checkin'")
    expect(host).not.toContain('function isSeated(a: Attendee)')
    expect(host).toContain('const seated = useMemo(() => attendees.filter(isSeated), [attendees])')
    // Counts, the list, "mark the rest" and the walk-in exclusion are seats only.
    expect(host).toContain('const checkedInCount = seated.filter(a => a.checkedIn).length')
    expect(host).toContain('{checkedInCount} / {seated.length} checked in')
    expect(host).toContain('attendees: seated')
    expect(host).toContain('exclude={new Set(seated.map(a => a.userId))}')
  })

  it('and the admin door counts seats too', () => {
    const admin = read('app/admin/checkin/page.tsx')
    expect(admin).toContain("import { vibrate, useScanCheckin, isSeated } from '@/lib/checkin'")
    expect(admin).toContain('const seated = useMemo(() => attendees.filter(isSeated), [attendees])')
    // The tiles and the bar: "4 / 32" for a room of nine, because the
    // waitlist and the unapproved were counted as seats.
    expect(admin).toContain('const checkedInCount = seated.filter(a => a.checkedIn).length')
    expect(admin).toContain('{seated.length - checkedInCount}')
    expect(admin).toContain('{seated.length}</div>')
    expect(admin).toContain("width: seated.length > 0 ? `${(checkedInCount / seated.length) * 100}%` : '0%'")
    expect(admin).not.toContain('attendees.length - checkedInCount')
    expect(admin).not.toContain('checkedInCount / attendees.length')
    // The rendered list, so no row 404s on a tap and no Excuse button
    // appears on somebody who holds no seat.
    expect(admin).toMatch(/const byView = view === 'in' \? seated\.filter/)
    expect(admin).toContain('}, [seated, search, view])')
    // "Mark the other N as no-show" offered people the close-out then skipped.
    expect(admin).toContain('useCloseOut({ eventId: selectedId, attendees: seated, setAttendees })')
    // And a waitlisted person can be seated from here again.
    expect(admin).toContain('exclude={new Set(seated.map(a => a.userId))}')
  })

  it('both doors still hand the scanner the whole roster', () => {
    // A waitlisted or unapproved person scanning their card must be named,
    // not called a stranger — that is what the wider roster is for.
    for (const p of ['app/host/checkin/page.tsx', 'app/admin/checkin/page.tsx']) {
      expect(read(p)).toMatch(/useScanCheckin\(\{[\s\S]*?\battendees\b,/)
    }
  })
})
