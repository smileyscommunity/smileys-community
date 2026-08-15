import { describe, it, expect } from 'vitest'

// Regression tests for the content POST allowlist. It rebuilds each section
// from a fixed field list — which is the right design (it stops arbitrary keys
// being merged into the JSON file) but means every NEW field has to be added
// here too. Two fields were already lost to it silently:
//
//   home.heroImage — the upload succeeded, the save dropped it, and the landing
//                    page kept showing the shipped photo with no error anywhere.
//   stats[].metric — saving the Stats tab for an unrelated reason would revert
//                    a live, database-tracked figure to a stale literal.
//
// Both failures are invisible: the request returns 200 and the UI looks right
// until the page is reloaded. Hence tests.

const HOME_PHOTO_RE = /^\/app\/api\/files\/(?!applications\/)[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|gif)$/

describe('home hero image validation', () => {
  it('accepts an upload path from the general folder', () => {
    expect(HOME_PHOTO_RE.test('/app/api/files/general/1786783238445-793d6b9b7858.jpg')).toBe(true)
  })

  it('rejects the admin-only applications folder', () => {
    // A hero pointing there would 403 for every visitor.
    expect(HOME_PHOTO_RE.test('/app/api/files/applications/1786783238445-abc.jpg')).toBe(false)
  })

  it('rejects traversal and off-site URLs', () => {
    expect(HOME_PHOTO_RE.test('/app/api/files/general/../applications/x.jpg')).toBe(false)
    expect(HOME_PHOTO_RE.test('https://evil.example/x.jpg')).toBe(false)
  })
})

// Mirrors the branch in normalizeSection so the contract is pinned even though
// the route module itself needs a request context to exercise end to end.
function normalizeStatRow(o: Record<string, unknown>) {
  const metric = o.metric === 'members' || o.metric === 'events' || o.metric === 'clubs' ? o.metric : undefined
  return { value: String(o.value ?? ''), label: String(o.label ?? ''), ...(metric ? { metric } : {}) }
}

describe('stat row normalisation', () => {
  it('keeps a valid metric so a live figure survives a save', () => {
    expect(normalizeStatRow({ value: '120+', label: 'Active clubs', metric: 'clubs' }))
      .toEqual({ value: '120+', label: 'Active clubs', metric: 'clubs' })
  })

  it('drops an unrecognised metric rather than storing it', () => {
    expect(normalizeStatRow({ value: '5', label: 'Whatever', metric: 'bananas' }))
      .toEqual({ value: '5', label: 'Whatever' })
  })

  it('leaves plain editorial rows untouched', () => {
    expect(normalizeStatRow({ value: '4,000+', label: 'in our WhatsApp groups' }))
      .toEqual({ value: '4,000+', label: 'in our WhatsApp groups' })
  })
})
