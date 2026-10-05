import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// Cancellations / standing plan — the four changes that needed no product ruling
// (2026-10-04). Pinned against the source: the components and cron need a
// browser / DB.
const read = (p: string) => readFileSync(p, 'utf-8')

describe('premium badge no longer ranks the membership', () => {
  it('says what Premium is, not who it is for', () => {
    const b = read('components/EventBadges.tsx')
    expect(b).not.toMatch(/vetted members/i)
    expect(b).toMatch(/A premium experience — the price and number of seats are on the event page/)
  })
})

describe('"Still coming?" has an honest second answer', () => {
  const c = read('components/RSVPButton.tsx')
  const card = c.slice(c.indexOf('Still coming?'), c.indexOf("You're attending"))
  it('offers Can\'t make it, through the ordinary cancel path', () => {
    expect(card).toMatch(/onClick=\{handleLeave\}/)
    expect(card).toMatch(/Can&apos;t make it/)
  })
  it('states the rule without promising a pass after the release point', () => {
    expect(card).toMatch(/Cancel more than \{RECONFIRM_RELEASE_HOURS_BEFORE\} hours before the start and nothing is recorded/)
  })
  it('keeps the confirm button', () => {
    expect(card).toMatch(/onClick=\{confirmComing\}/)
  })
})

describe('a released seat is unmistakably released', () => {
  const r = read('lib/reconfirm.ts')
  const e = read('lib/email.ts')
  it('push says the seat was released and is no longer held', () => {
    expect(r).toMatch(/Your seat at \$\{event\.title\} was released/)
    expect(r).toMatch(/Your seat is no longer held\./)
    expect(r).not.toMatch(/went to the waitlist`/)
  })
  it('email says the same, and does not call it a soft "spot"', () => {
    const fn = e.slice(e.indexOf('export async function sendSpotReleasedEmail'))
    expect(fn).toMatch(/Your seat at \$\{eventTitle\} was released/)
    expect(fn).toMatch(/your seat is no longer held/)
    expect(fn).toMatch(/This doesn't count against you/)
  })
})

describe('seats-wasted measurement', () => {
  const s = read('scripts/measure-seats-wasted.ts')
  it('uses the plan\'s formula: (no-shows + late cancels) over capacity, auto-releases on their own line', () => {
    expect(s).toMatch(/SEATS WASTED\s+\$\{ghosts \+ late\}/)
    expect(s).toMatch(/pct\(ghosts \+ late, cap\)/)
    expect(s).toMatch(/auto-released/)
  })
  it('counts a ghost only where the door was really used, excludes host and co-hosts, splits free/paid', () => {
    expect(s).toMatch(/NO_SHOW_MIN_CHECKIN_RATIO/)
    expect(s).toMatch(/a\."userId" <> e\."hostId"/)
    expect(s).toMatch(/event_cohosts/)
    expect(s).toMatch(/\(e\.price > 0\) AS paid/)
  })
  it('is read-only', () => {
    expect(s).not.toMatch(/\$executeRaw|\.(create|update|delete|upsert)(Many)?\(/)
  })
})
