import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf8')

// "Active this week" summed three different things and called all of them
// activities: an event in the next seven days, a hangout from the last seven,
// a board post from the last seven. Book Club showed "2 activities this week"
// when it had one meeting on the 23rd and one Book Swap post — right number,
// wrong word, and it read as two things happening.

// Mirror of activitySummary in app/clubs/ClubsClient.tsx. Kept here rather
// than exported from a 'use client' page module; the source assertions below
// hold the two in step.
function summary(c: { activityThisWeek?: number; activityParts?: { events: number; posts: number; hangouts: number } }): string {
  const p = c.activityParts
  const n = c.activityThisWeek ?? 0
  if (!p) return `${n} activit${n !== 1 ? 'ies' : 'y'} this week`
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const bits = [
    p.events   ? plural(p.events,   'event')   : null,
    p.hangouts ? plural(p.hangouts, 'hangout') : null,
    p.posts    ? plural(p.posts,    'post')    : null,
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : `${n} activit${n !== 1 ? 'ies' : 'y'} this week`
}

describe('what the strip says a club did', () => {
  it('names Book Club\'s real week instead of calling it 2 activities', () => {
    expect(summary({ activityThisWeek: 2, activityParts: { events: 1, posts: 1, hangouts: 0 } }))
      .toBe('1 event · 1 post')
  })

  it('a club with only events says only events', () => {
    // Coworking: three real meetings, nothing else.
    expect(summary({ activityThisWeek: 3, activityParts: { events: 3, posts: 0, hangouts: 0 } }))
      .toBe('3 events')
  })

  it('leaves out the parts that are zero', () => {
    expect(summary({ activityThisWeek: 1, activityParts: { events: 0, posts: 0, hangouts: 1 } }))
      .toBe('1 hangout')
  })

  it('puts what is happening before what was said about it', () => {
    expect(summary({ activityThisWeek: 6, activityParts: { events: 1, posts: 3, hangouts: 2 } }))
      .toBe('1 event · 2 hangouts · 3 posts')
  })

  it('singular and plural, per part', () => {
    expect(summary({ activityThisWeek: 4, activityParts: { events: 2, posts: 1, hangouts: 1 } }))
      .toBe('2 events · 1 hangout · 1 post')
  })

  it('falls back to the old wording for a response cached before the parts existed', () => {
    // The route is unstable_cache'd; a warm entry has no activityParts.
    expect(summary({ activityThisWeek: 2 })).toBe('2 activities this week')
    expect(summary({ activityThisWeek: 1 })).toBe('1 activity this week')
  })
})

describe('the page and the API agree', () => {
  it('the API sends the parts, not just the total', () => {
    const src = read('app/api/clubs/route.ts')
    expect(src).toContain('activityParts: {')
    expect(src).toMatch(/events:\s+we\.get\(c\.id\)/)
    expect(src).toMatch(/posts:\s+wp\.get\(c\.id\)/)
    expect(src).toMatch(/hangouts:\s+wh\.get\(c\.id\)/)
  })

  it('the strip renders the summary, not the bare count', () => {
    const src = read('app/clubs/ClubsClient.tsx')
    expect(src).toContain('{activitySummary(c)}')
    expect(src).not.toMatch(/\{c\.activityThisWeek\} activit\{/)
  })

  it('the total still ranks the strip', () => {
    // The parts are for reading; ordering stays on the sum.
    expect(read('app/clubs/ClubsClient.tsx')).toContain('(b.activityThisWeek ?? 0) - (a.activityThisWeek ?? 0)')
  })
})
