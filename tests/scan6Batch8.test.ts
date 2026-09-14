import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { cardButtonState, JOIN_BLOCK_LABEL, type JoinBlock, type Participation } from '@/lib/eventJoinState'

const read = (p: string) => readFileSync(p, 'utf-8')

// Batch 8 — the card's closed label hid the member's own status; club and
// homepage cards judged join state on Istanbul's clock.

const BLOCKS: Exclude<JoinBlock, null>[] = ['cancelled', 'postponed', 'closed', 'deadline', 'ended', 'started']

describe('a. cardButtonState: own status beats every closed reason', () => {
  for (const block of BLOCKS) {
    for (const status of ['joined', 'pending', 'waitlisted'] as const) {
      it(`${status} on a ${block} event shows the member's own status`, () => {
        expect(cardButtonState(block, status)).toEqual({ kind: 'mine', status })
      })
    }
    for (const status of ['idle', 'error', 'loading'] as Participation[]) {
      it(`${status} on a ${block} event shows "${JOIN_BLOCK_LABEL[block]}"`, () => {
        expect(cardButtonState(block, status)).toEqual({ kind: 'closed', block, label: JOIN_BLOCK_LABEL[block] })
      })
    }
  }

  it('the scenario: pending past the registration deadline stays pending', () => {
    expect(cardButtonState('deadline', 'pending')).toEqual({ kind: 'mine', status: 'pending' })
  })

  it('an open event: members keep their status, everyone else gets the button', () => {
    expect(cardButtonState(null, 'joined')).toEqual({ kind: 'mine', status: 'joined' })
    expect(cardButtonState(null, 'waitlisted')).toEqual({ kind: 'mine', status: 'waitlisted' })
    expect(cardButtonState(null, 'idle')).toEqual({ kind: 'open' })
    expect(cardButtonState(null, 'error')).toEqual({ kind: 'open' })
  })

  it('matches RSVPButton: the closed label only for idle, error and loading', () => {
    expect(read('components/RSVPButton.tsx')).toMatch(/if \(closedLabel && \(status === 'idle' \|\| status === 'error' \|\| status === 'loading'\)\)/)
  })
})

describe('a. EventCard uses it', () => {
  const src = read('components/EventCard.tsx')
  it('derives the closed label from cardButtonState, not a started/ended special case', () => {
    expect(src).toContain('const buttonState  = cardButtonState(block, status)')
    expect(src).toContain("const blockedLabel = buttonState.kind === 'closed' ? buttonState.label : null")
    expect(src).not.toContain('keepsJoined')
    expect(src).not.toMatch(/joinBlockLabel\(/)
  })
})

describe('b. cards judge join state on the event city clock', () => {
  it('ClubTabs passes each event\'s city zone to EventCard', () => {
    const tabs = read('app/(member)/clubs/[slug]/ClubTabs.tsx')
    expect(tabs).toContain('timeZone={(event.cityId && cityTimeZones[event.cityId]) || DEFAULT_TZ}')
    const page = read('app/(member)/clubs/[slug]/page.tsx')
    expect(page).toContain('cityTimeZones={cityTimeZones}')
    // One query for the distinct cities — not a lookup per event.
    expect(page).toMatch(/prisma\.city\.findMany\(\{ where: \{ id: \{ in: eventCityIds \} \}, select: \{ id: true, timezone: true \} \}\)/)
  })

  it('the homepage carries each live city\'s zone and EventTabs prefers it', () => {
    const home = read('app/page.tsx')
    expect(home).toContain("select: { id: true, name: true, timezone: true }")
    expect(home).toContain('timeZone: e.cityId ? cityTzById[e.cityId] : undefined')
    expect(read('components/EventTabs.tsx')).toContain('timeZone={e.timeZone ?? timeZone}')
  })
})
