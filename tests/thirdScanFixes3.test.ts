import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { sanitize } from '@/lib/sanitize'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('16 maps', () => {
  it('directory pins are keyed on content and drawn once the map exists', () => {
    const src = read('components/DirectoryMap.tsx')
    expect(src).toMatch(/const \[ready, setReady\] = useState\(false\)/)
    expect(src).toMatch(/\}, \[ready, pinKey, onPinClick, defaultCenter\?\.\[0\], defaultCenter\?\.\[1\]\]\)/)
  })
  it('event pins re-sync when the set changes, not only its size', () => {
    const src = read('components/EventMap.tsx')
    expect(src).toMatch(/const pinKey = mappable\.map\(e => e\.id\)\.join\(','\)/)
    expect(src).toMatch(/\}, \[ready, pinKey, selectedId, attendance\]\)/)
    expect(src).toMatch(/\}, \[ready, defaultCenter\?\.lat, defaultCenter\?\.lng, mappable\.length\]\)/)
  })
})

describe('17 partner login', () => {
  it('keeps partnerId on the client user and lands on the portal', () => {
    const src = read('app/login/page.tsx')
    expect(src).toMatch(/partnerId:\s*data\.partnerId,/)
    expect(src).toMatch(/else if \(data\.role === 'partner'\) router\.push\('\/partner'\)/)
    expect(read('lib/auth.ts')).toMatch(/partnerId\?: string \| null/)
  })
})

describe('18 stale-chunk reload', () => {
  it('is guarded to once per minute in both error boundaries', () => {
    expect(read('app/error.tsx')).toMatch(/if \(isStaleChunk\) reloadOnceForStaleChunk\(\)/)
    expect(read('app/error.tsx')).toMatch(/if \(Date\.now\(\) - last < 60_000\) return/)
    expect(read('app/global-error.tsx')).toMatch(/if \(Date\.now\(\) - last >= 60_000\)/)
  })
})

describe('19 cron health', () => {
  it('records a run with failed sends as not ok', () => {
    expect(read('app/api/cron/sweep-login-nudge/route.ts')).toMatch(/recordCronRun\('sweep-login-nudge', failed === 0/)
    expect(read('app/api/cron/first-rsvp-nudge/route.ts')).toMatch(/recordCronRun\('sweep-first-rsvp-nudge', result\.failed === 0/)
    expect(read('app/api/cron/sweep-newsletters/route.ts')).toMatch(/recordCronRun\('sweep-newsletters', result\.failedIssues === 0/)
  })
})

describe('20 busy flags recover', () => {
  it.each([
    ['components/EventReviews.tsx', /catch \{\s*setError\('Network error — try again'\)\s*\} finally \{\s*setSubmitting\(false\)/],
    ['components/ClubAnnouncements.tsx', /finally \{\s*setPosting\(false\)/],
    ['components/ClubResources.tsx', /finally \{\s*setAdding\(false\)/],
    ['components/ClubRulesEditor.tsx', /finally \{\s*setSaving\(false\)/],
    ['components/ClubSpotlight.tsx', /finally \{\s*setSaving\(false\)/],
    ['components/NeighborhoodWall.tsx', /finally \{\s*setReplying\(false\)/],
    ['components/NeighborhoodWall.tsx', /finally \{\s*setPosting\(false\)/],
    ['components/MovingSales.tsx', /err instanceof ImageUploadError \? err\.message/],
    ['components/EventPhotos.tsx', /if \(!res\.ok\) \{ toast\.error\('Could not delete the photo'\); return \}/],
    ['components/BoardFeed.tsx', /setReplies\(\[\]\)\s*\/\/ not "Loading…" forever/],
    ['components/BoardFeed.tsx', /if \(reacting\.current\) return/],
    ['components/BoardHub.tsx', /if \(!res\?\.ok\) \{ toast\.error\('Could not delete the listing'\); return \}/],
    ['app/(member)/board/new/page.tsx', /setError\('Could not reach the server — your listing is still here, try again'\)/],
    ['app/(member)/clubs/[slug]/ClubJoinWidget.tsx', /finally \{\s*setLoading\(false\)/],
    ['app/host/events/new/page.tsx', /finally \{\s*setAiLoading\(false\)/],
    ['app/(member)/reviews/page.tsx', /r\.ok \? r\.json\(\) : Promise\.reject/],
    ['app/appeal/page.tsx', /setError\('Could not reach the server — try again'\)/],
  ])('%s', (file, re) => {
    expect(read(file)).toMatch(re)
  })
  it.each(['components/ClubMembers.tsx', 'components/ClubPastEvents.tsx', 'components/ClubReviews.tsx', 'components/admin/CupFixturesPanel.tsx'])('%s catches a failed load', (file) => {
    expect(read(file)).toMatch(/\.catch\(\(\) => \{\}\)[^\n]*\n\s*\.finally\(/)
  })
})

describe('21 rate limits', () => {
  it('listings daily cap, event photos, hangout edits, uploads per member, post views', () => {
    expect(read('app/api/listings/route.ts')).toMatch(/rateLimit\(`listings-create-day:\$\{session\.id\}`, 10, 24 \* 60 \* 60_000\)/)
    expect(read('app/api/events/[id]/photos/route.ts')).toMatch(/rateLimit\(`event-photo:\$\{session\.id\}`, 10, 60_000\)/)
    expect(read('app/api/hangouts/[id]/route.ts')).toMatch(/rateLimit\(`hangout-edit:\$\{session\.id\}`, 10, 60_000\)/)
    const up = read('app/api/upload/route.ts')
    expect(up).toMatch(/rateLimit\(`upload:\$\{session\.id\}`, 20, 60 \* 60_000\)/)
    expect(up.indexOf('const session = await getSession()')).toBeLessThan(up.indexOf('rateLimit(`upload:'))
    expect(read('app/api/posts/[slug]/view/route.ts')).toMatch(/rateLimit\(`post-view:\$\{getIp\(req\)\}`, 60, 60_000\)/)
  })
})

describe('22 report double-submit', () => {
  it('is serialised by a claim', () => {
    expect(read('app/api/reports/route.ts')).toMatch(/claimOnce\(`report:\$\{session\.id\}:\$\{reportedId\}`, 60_000\)/)
  })
})

describe('23 small follow-ups', () => {
  it('retention hides a masked mailto; reminder mail prints a readable day; failed newsletters render; private members tab is not deep-linkable', () => {
    expect(read('app/admin/retention/page.tsx')).toMatch(/\{!m\.email\.includes\('\.\.\.@'\) && \(/)
    expect(read('lib/email.ts')).not.toMatch(/\$\{esc\(eventDate\)\}/)
    expect(read('app/admin/newsletter/page.tsx')).toMatch(/isFailed \? '✗ failed'/)
    expect(read('app/(member)/clubs/[slug]/ClubTabs.tsx')).toMatch(/\(param !== 'members' \|\| membersAllowed\)/)
  })
})

describe('24 assorted', () => {
  it('events paginate with an id tiebreak; NPS slice is ordered; OG params are bounded', () => {
    expect(read('lib/db.ts')).toMatch(/\{ time: 'asc' \}, \{ id: 'asc' \}\]/)
    expect(read('app/api/cron/sweep-nps/route.ts')).toMatch(/orderBy: \{ joinedAt: 'asc' \}/)
    expect(read('app/api/og/route.tsx')).toMatch(/\.slice\(0, 60\)/)
  })
  it('the sanitizer refuses protocol-relative links', () => {
    expect(sanitize('<a href="//evil.com/x">x</a>')).not.toContain('evil.com')
    expect(sanitize('<a href="https://ok.example/x">x</a>')).toContain('https://ok.example/x')
  })
  it('storage reads are guarded in the review prompts; the dead host self-grant is gone; two more day-shift displays fixed', () => {
    expect(read('components/ReviewReminder.tsx')).not.toMatch(/(?<!try \{ )localStorage\.setItem/)
    // Only the guarded helper may touch storage directly.
    expect(read('components/VenueReviewPrompt.tsx')).not.toMatch(/(?<!try \{ return )localStorage\.getItem/)
    expect(read('app/host/events/new/page.tsx')).not.toMatch(/\/app\/api\/admin\/clubs\/\$\{form\.clubId\}\/hosts/)
    expect(read('app/host/events/[id]/edit/page.tsx')).toMatch(/buildSpawnDates\(\)\.map\(d => formatDay\(d/)
    expect(read('app/(member)/no-show/page.tsx')).toMatch(/formatDay\(iso, \{ day: 'numeric', month: 'long' \}\)/)
  })
})
