import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// Messages (DM) UI review, 2026-09-20. The helpers below are the parts the two
// pages were getting wrong on their own: a failed poll that emptied the inbox,
// a poll that only ever appended, and "Yesterday" computed in 24-hour hops
// that contradicted the day separator printed right above it.
import { readInbox, mergeMessages, toggleReactionLocal } from '@/app/(member)/messages/messageData'
import { dayKeyOf, daysBefore, daySeparator, messageTime } from '@/app/(member)/messages/messageTime'

const inboxSrc  = readFileSync('app/(member)/messages/page.tsx', 'utf-8')
const threadSrc = readFileSync('app/(member)/messages/[userId]/page.tsx', 'utf-8')

const msg = (id: string, createdAt: string, extra: Record<string, unknown> = {}) =>
  ({ id, createdAt, text: id, isRead: false, reactions: [], ...extra }) as any

describe('1 a failed inbox refresh keeps what is on screen', () => {
  it('reads the object payload', () => {
    const inbox = readInbox({
      conversations: [{
        partner: { id: 'u1', name: 'Ada', color: '#111', profilePhoto: null, restricted: true },
        preview: { text: '', hasImage: true },
        unread: 3,
        lastAt: '2026-09-20T10:00:00.000Z',
      }],
      totalUnread: 7,
    })
    expect(inbox?.conversations).toHaveLength(1)
    expect(inbox?.conversations[0].partner.restricted).toBe(true)
    expect(inbox?.conversations[0].preview).toEqual({ text: '', hasImage: true })
    // The server counts every thread, not just this page of them.
    expect(inbox?.totalUnread).toBe(7)
  })

  it('answers null for anything that is not an inbox — including the old array', () => {
    expect(readInbox(null)).toBeNull()
    expect(readInbox([])).toBeNull()
    expect(readInbox({ error: 'Server error' })).toBeNull()
    expect(readInbox('nope')).toBeNull()
  })

  it('distinguishes a truly empty inbox from a failed one', () => {
    expect(readInbox({ conversations: [], totalUnread: 0 })).toEqual({ conversations: [], totalUnread: 0 })
  })

  it('the page only empties on a real answer, and says when a refresh failed', () => {
    expect(inboxSrc).not.toContain('setConvs(Array.isArray')
    // null state = never loaded, so the empty state can't stand in for a blip.
    expect(inboxSrc).toContain('useState<Conversation[] | null>(null)')
    expect(inboxSrc).toContain('Couldn&apos;t refresh')
    expect(inboxSrc).toContain("'📷 Photo'")
  })
})

describe('5-6 a refresh merges instead of appending', () => {
  it('never appends the same message twice', () => {
    const current = [msg('a', '2026-09-20T10:00:00Z'), msg('b', '2026-09-20T10:01:00Z')]
    const merged = mergeMessages(current, [msg('b', '2026-09-20T10:01:00Z')])
    expect(merged.map(m => m.id)).toEqual(['a', 'b'])
  })

  it('updates changed rows — read receipts and reactions', () => {
    const current = [msg('a', '2026-09-20T10:00:00Z')]
    const merged = mergeMessages(current, [
      msg('a', '2026-09-20T10:00:00Z', { isRead: true, reactions: [{ userId: 'u2', emoji: '❤️' }] }),
    ], { full: true })
    expect(merged[0].isRead).toBe(true)
    expect(merged[0].reactions).toHaveLength(1)
  })

  it('drops a message the full refresh no longer has', () => {
    const current = [msg('a', '2026-09-20T10:00:00Z'), msg('b', '2026-09-20T10:01:00Z')]
    const merged = mergeMessages(current, [msg('a', '2026-09-20T10:00:00Z')], { full: true })
    expect(merged.map(m => m.id)).toEqual(['a'])
  })

  it('keeps history older than the refreshed window', () => {
    const older = msg('old', '2026-09-01T09:00:00Z')
    const current = [older, msg('a', '2026-09-20T10:00:00Z')]
    const merged = mergeMessages(current, [msg('a', '2026-09-20T10:00:00Z')], { full: true })
    expect(merged.map(m => m.id)).toEqual(['old', 'a'])
  })

  it('keeps a message sent after the refresh went out', () => {
    const current = [msg('a', '2026-09-20T10:00:00Z'), msg('mine', '2026-09-20T10:02:00Z')]
    const merged = mergeMessages(current, [msg('a', '2026-09-20T10:00:00Z')], { full: true, keep: ['mine'] })
    expect(merged.map(m => m.id)).toEqual(['a', 'mine'])
  })

  it('an incremental response never deletes anything', () => {
    const current = [msg('a', '2026-09-20T10:00:00Z')]
    expect(mergeMessages(current, []).map(m => m.id)).toEqual(['a'])
  })

  it('an empty full response empties the thread', () => {
    expect(mergeMessages([msg('a', '2026-09-20T10:00:00Z')], [], { full: true })).toEqual([])
  })

  it('older history lands in front, in order', () => {
    const current = [msg('c', '2026-09-20T10:00:00Z')]
    const older = [msg('a', '2026-09-18T10:00:00Z'), msg('b', '2026-09-19T10:00:00Z')]
    expect(mergeMessages(current, older).map(m => m.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('4 an empty thread still polls', () => {
  it('the poll runs a full load when there is no cursor', () => {
    expect(threadSrc).toContain('if (!since || tickRef.current % FULL_REFRESH_EVERY === 0) load()')
    // The old guard: nothing was ever fetched until a fetch had succeeded.
    expect(threadSrc).not.toContain('if (lastMsgRef.current) load(lastMsgRef.current)')
  })
})

describe('12 reactions answer back', () => {
  it('toggles locally for the optimistic paint', () => {
    const reactions = [{ userId: 'me', emoji: '❤️' }, { userId: 'you', emoji: '❤️' }]
    expect(toggleReactionLocal(reactions, 'me', '❤️')).toEqual([{ userId: 'you', emoji: '❤️' }])
    expect(toggleReactionLocal(reactions, 'me', '👍')).toHaveLength(3)
    // Logged-out/unknown viewer: nothing to toggle, and no crash.
    expect(toggleReactionLocal(reactions, undefined, '👍')).toEqual(reactions)
  })

  it('a failed reaction rolls back and says so', () => {
    expect(threadSrc).toContain('Reaction not saved')
    expect(threadSrc).toContain('rollback(')
  })

  it('the picker can be dismissed and flips when it would be clipped', () => {
    expect(threadSrc).toContain("e.key === 'Escape'")
    expect(threadSrc).toContain('[data-reaction-ui]')
    expect(threadSrc).toContain("reacting.above ? 'bottom-full mb-1' : 'top-full mt-1'")
  })
})

describe('15 day labels come from calendar days in the city timezone', () => {
  const tz = 'Europe/Istanbul'

  it('a message just before midnight belongs to that calendar day', () => {
    // 23:50 Istanbul on the 19th is 20:50 UTC — the browser's own day would
    // disagree for a reader west of the city.
    expect(dayKeyOf('2026-09-19T20:50:00.000Z', tz)).toBe('2026-09-19')
    expect(dayKeyOf('2026-09-19T21:10:00.000Z', tz)).toBe('2026-09-20')
  })

  it('counts whole days, not 24-hour hops', () => {
    expect(daysBefore('2026-09-19', '2026-09-20')).toBe(1)
    expect(daysBefore('2026-09-20', '2026-09-20')).toBe(0)
    expect(daysBefore('2026-09-13', '2026-09-20')).toBe(7)
  })

  it('separator: Today, Yesterday, weekday, then a date with the year', () => {
    expect(daySeparator('2026-09-20', '2026-09-20')).toBe('Today')
    expect(daySeparator('2026-09-19', '2026-09-20')).toBe('Yesterday')
    expect(daySeparator('2026-09-16', '2026-09-20')).toBe('Wednesday')
    expect(daySeparator('2026-08-12', '2026-09-20')).not.toContain('2026')
    expect(daySeparator('2025-08-12', '2026-09-20')).toContain('2025')
  })

  it('the stamp agrees with the separator above it', () => {
    // 23:50 on the 19th, read on the 20th: "Yesterday", the same word the
    // separator uses — the old 48-hour arithmetic called this one "Yesterday"
    // under a separator that said Saturday.
    expect(messageTime('2026-09-19T20:50:00.000Z', '2026-09-20', tz)).toBe('Yesterday 23:50')
    expect(messageTime('2026-09-20T07:05:00.000Z', '2026-09-20', tz)).toBe('10:05')
    expect(messageTime('2025-08-12T09:00:00.000Z', '2026-09-20', tz)).toContain('2025')
  })

  it('midnight renders as 00:xx, never 24:xx', () => {
    expect(messageTime('2026-09-19T21:05:00.000Z', '2026-09-20', tz)).toBe('00:05')
  })
})

describe('7-18 the thread pages behave', () => {
  it('delete is reachable on touch and confirmed', () => {
    expect(threadSrc).toContain("confirmToast('Delete this message?')")
    expect(threadSrc).not.toContain("className=\"opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-400")
    expect(threadSrc).toContain('aria-label="Delete message"')
  })

  it('no native dialogs anywhere in the messages UI', () => {
    for (const src of [inboxSrc, threadSrc]) {
      expect(src).not.toMatch(/(^|[^.\w])confirm\(/)
      expect(src).not.toMatch(/(^|[^.\w])alert\(/)
    }
  })

  it('a refused send keeps the draft and uses the server sentence', () => {
    expect(threadSrc).toContain('setSendLock(')
    expect(threadSrc).toContain("d?.reason === 'blocked' ? 'blocked' : 'not_connected'")
    // No setText('') on the 403 path, and the box stays on screen.
    expect(threadSrc).toContain('readOnly={!!writeBlock}')
  })

  it('a blocked thread says so instead of inviting a hello', () => {
    expect(threadSrc).toContain('You can’t message this person')
    expect(threadSrc).toContain('You blocked this member. You can still read what was said.')
  })

  it('opening a chat does not record a profile view', () => {
    expect(threadSrc).toContain('?context=dm')
  })

  it('presence is 20 minutes, and silent for a locked partner', () => {
    expect(threadSrc).toContain('ONLINE_WITHIN_MIN = 20')
    expect(threadSrc).toContain('if (partner.locked || lock) return null')
  })

  it('the composer guards IME composition and grows with content', () => {
    expect(threadSrc).toContain('e.nativeEvent.isComposing')
    expect(threadSrc).toContain('line * 6')
  })

  it('the list scrolls, not the page, and only when already at the bottom', () => {
    expect(threadSrc).not.toContain('scrollIntoView')
    expect(threadSrc).toContain('NEAR_BOTTOM_PX')
    expect(threadSrc).not.toContain("height: 'calc(100dvh - 240px)'")
  })

  it('the message list is announced', () => {
    expect(threadSrc).toContain('role="log"')
    expect(threadSrc).toContain('aria-live="polite"')
    expect(threadSrc).toContain('Photo from ${msg.from?.name ?? partnerName}')
  })

  it('older history has a way in', () => {
    expect(threadSrc).toContain('Load older messages')
    expect(threadSrc).toContain('?before=${encodeURIComponent(before)}')
  })
})
