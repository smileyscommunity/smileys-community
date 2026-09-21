import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The real readFileSync, captured before the mock below replaces it — the
// source-reading assertions at the bottom must not go through the stub.
const realFs = await vi.importActual<typeof import('fs')>('fs')
const read = (p: string) => realFs.readFileSync(p, 'utf8')

// The announcement lives in a file because deploy.sh excludes it from the
// rsync, so the live banner survives a deploy. The cost of that is it can be
// edited straight on the server — and was: the banner live on 2026-09-19
// carried updatedBy but left no audit row, and its timestamp ended in exactly
// .000ms, so it never went through the POST route and never met the
// 300-character cap or isSafeHref.
//
// Two consequences this covers: the parsing has to be defensive wherever it
// happens, and the admin page should not present an unchecked banner as if
// the form had produced it.

vi.mock('fs', async (orig) => {
  const real = await orig<typeof import('fs')>()
  return { ...real, readFileSync: vi.fn(real.readFileSync) }
})

let fs: typeof import('fs')
let mod: typeof import('@/lib/announcement')

beforeEach(async () => {
  vi.resetModules()
  fs  = await import('fs')
  mod = await import('@/lib/announcement')
})
afterEach(() => vi.restoreAllMocks())

// Stub only the announcement file; every other read falls through to disk,
// or the module graph itself stops loading.
const onDisk = (raw: string) => {
  vi.mocked(fs.readFileSync).mockImplementation(((p: never, ...rest: never[]) =>
    String(p).endsWith('announcement.json') ? raw : realFs.readFileSync(p, ...rest)) as never)
}

describe('reading the file', () => {
  it('takes a well-formed announcement as written', () => {
    onDisk(JSON.stringify({ text: 'Hello', link: '/events', active: true, updatedAt: '2026-09-19T16:10:20.000Z', updatedBy: 'Nate G.' }))
    const a = mod.readAnnouncement()
    expect(a.text).toBe('Hello')
    expect(a.link).toBe('/events')
    expect(a.active).toBe(true)
  })

  // The dashboard used to JSON.parse this itself and check only
  // `raw.active && raw.text`, so a number would have reached the banner.
  it.each([
    ['a number where text belongs', { text: 42, link: '/x', active: true }],
    ['a null text',                 { text: null, link: '/x', active: true }],
    ['an object where link belongs', { text: 'Hi', link: { href: '/x' }, active: true }],
  ])('drops %s', (_label, raw) => {
    onDisk(JSON.stringify(raw))
    const a = mod.readAnnouncement()
    expect(typeof a.text).toBe('string')
    expect(typeof a.link).toBe('string')
  })

  it('an active flag has to be exactly true, not truthy', () => {
    onDisk(JSON.stringify({ text: 'Hi', link: '', active: 'yes' }))
    expect(mod.readAnnouncement().active).toBe(false)
  })

  it('invalid JSON is an empty announcement, not a crash', () => {
    onDisk('{ not json')
    expect(mod.readAnnouncement()).toEqual(mod.EMPTY_ANNOUNCEMENT)
  })

  it('liveAnnouncement withholds anything inactive or textless', () => {
    onDisk(JSON.stringify({ text: 'Hi', link: '', active: false }))
    expect(mod.liveAnnouncement()).toBeNull()
    onDisk(JSON.stringify({ text: '', link: '', active: true }))
    expect(mod.liveAnnouncement()).toBeNull()
    onDisk(JSON.stringify({ text: 'Hi', link: '', active: true }))
    expect(mod.liveAnnouncement()?.text).toBe('Hi')
  })
})

describe('telling a form-written banner from a hand-edited one', () => {
  it('flags the one that is live today — updatedBy set, no updatedVia', () => {
    expect(mod.setOutsideTheApp({ updatedAt: '2026-09-19T16:10:20.000Z', updatedVia: null })).toBe(true)
  })
  it('clears once this form has written it', () => {
    expect(mod.setOutsideTheApp({ updatedAt: '2026-09-21T10:00:00.123Z', updatedVia: 'admin' })).toBe(false)
  })
  it('an announcement that was never set is not "unverified"', () => {
    expect(mod.setOutsideTheApp({ updatedAt: null, updatedVia: null })).toBe(false)
  })
  it('tolerates the field being absent, as a cached response would have it', () => {
    expect(mod.setOutsideTheApp({ updatedAt: '2026-09-19T16:10:20.000Z' })).toBe(true)
  })
})

describe('one reader, used by everyone who reads it', () => {
  it('the dashboard no longer parses the file itself', () => {
    const src = read('app/(member)/dashboard/page.tsx')
    expect(src).toContain('liveAnnouncement()')
    expect(src).not.toContain("'announcement.json'")
  })

  it('the route shares the same reader rather than keeping its own', () => {
    const src = read('app/api/admin/announcement/route.ts')
    expect(src).toContain("from '@/lib/announcement'")
    expect(src).not.toMatch(/function read\(\): StoredAnnouncement/)
  })

  it('the route stamps what it writes, so the next edit can be told apart', () => {
    const src = read('app/api/admin/announcement/route.ts')
    expect(src).toContain('updatedVia: ADMIN_SOURCE')
    expect(src).toContain('updatedVia: payload.updatedVia')   // echoed to the client
  })

  it('the admin page shows the notice, and only once loaded', () => {
    const src = read('app/admin/announcements/page.tsx')
    expect(src).toContain('setOutsideTheApp(committed)')
    expect(src).toContain("This banner wasn&apos;t set from here")
    // Against `committed`, not `data`: typing in the box must not clear a
    // warning about what is still live.
    expect(src).not.toContain('setOutsideTheApp(data)')
  })
})
