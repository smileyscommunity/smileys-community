import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('12 directory review nudge', () => {
  it('takes the year-long claim only after finding something to send', () => {
    const src = read('app/api/cron/sweep-review-nudges/route.ts')
    expect(src.indexOf('if (!candidates.length) continue')).toBeLessThan(src.indexOf('claimOnce(`dir-review-nudge:'))
    // Anchor on the send itself: the type string also appears earlier, in the ledger query.
    expect(src.indexOf('claimOnce(`dir-review-nudge:')).toBeLessThan(src.indexOf('await createNotification('))
  })
})

describe('13 recap card', () => {
  it('is shown only to people the recap admits', () => {
    expect(read('app/events/[id]/page.tsx')).toMatch(/\{isPast && canSeeInside && \(\s*<Link href=\{`\/events\/\$\{event\.id\}\/recap`\}/)
  })
})

describe('14 listings daily cap', () => {
  it('is charged after validation, right before the write', () => {
    const src = read('app/api/listings/route.ts')
    const cap = src.indexOf('listings-create-day:')
    expect(cap).toBeGreaterThan(src.indexOf("'Title and description are required'"))
    expect(cap).toBeGreaterThan(src.indexOf('await safeNeighborhoodFor('))
    expect(cap).toBeLessThan(src.indexOf('prisma.listing.create('))
  })
})
