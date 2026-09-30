import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = (p: string) => readFileSync(p, 'utf8')

// The rows above the events feed (Coming up, This weekend, …) are their own
// tiles fed by their own API, so a field the feed's cards show doesn't reach
// them unless both ends carry it. Language went missing exactly that way.
describe('events discovery tiles show the event language', () => {
  it('the discovery API selects and returns it', () => {
    const route = src('app/api/events/discovery/route.ts')
    expect(route).toMatch(/CARD_SELECT = \{[\s\S]*?language: true/)
    expect(route).toMatch(/language: e\.language \?\? null/)
  })
  it('the tile renders it only when the host set one', () => {
    expect(src('app/events/EventDiscovery.tsx')).toMatch(/e\.language\?\.trim\(\) && \(/)
  })
})
