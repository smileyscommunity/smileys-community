import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { atHourInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { reviewLabel } from '@/lib/handbook-review'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('atHourInTz across a DST changeover', () => {
  it('"tonight at 19:00" on spring-forward morning in New York is 23:00Z, not midnight', () => {
    // 2026-03-08 01:00 EST (06:00Z); clocks jump at 02:00. 19:00 EDT = 23:00Z.
    // The old offset arithmetic (now + hour − minutesNow) gave 00:00Z.
    const now = new Date('2026-03-08T06:00:00Z')
    expect(atHourInTz(19, 'America/New_York', now).toISOString()).toBe('2026-03-08T23:00:00.000Z')
  })
  it('is unchanged on an ordinary day', () => {
    expect(atHourInTz(19, 'Europe/Istanbul', new Date('2026-09-10T08:00:00Z')).toISOString()).toBe('2026-09-10T16:00:00.000Z')
  })
})

describe('handbook review label', () => {
  it('renders the review day on the default city calendar, not the server\'s', () => {
    // 21:30Z on the 9th is 00:30 on the 10th in Istanbul.
    const label = reviewLabel({ category: 'visas', lastReviewedAt: new Date('2026-09-09T21:30:00Z'), reviewIntervalDays: 365 }, new Date('2026-09-11T00:00:00Z'))
    expect(label?.text).toBe('Last reviewed 10 September 2026')
    expect(DEFAULT_TZ).toBe('Europe/Istanbul')
  })
})

describe('city stats "today"', () => {
  it('is computed per city from its own timezone', () => {
    const src = read('lib/cities.ts')
    expect(src).toMatch(/const todayOf = \(id: string\) => todayInTz\(zones\.find\(z => z\.id === id\)\?\.timezone \?\? DEFAULT_TZ\)/)
    expect(src).toMatch(/OR: cityIds\.map\(id => \(\{ cityId: id, date: \{ gte: todayOf\(id\) \} \}\)\)/)
  })
})

describe('newsletter spotlight CTA', () => {
  it('appends UTM with & when the href already carries a query', () => {
    expect(read('lib/newsletterDigest.ts')).toMatch(/\$\{href\}\$\{href\.includes\('\?'\) \? '&' : '\?'\}\$\{UTM\}/)
  })
})

describe('broadcast email', () => {
  it('sends its subject through safeSubject like every other helper', () => {
    const src = read('lib/email.ts')
    expect(src).not.toMatch(/subject: title,/)
    expect(src).toMatch(/subject: safeSubject\(title\),/)
  })
})

describe('public directory reviews', () => {
  it('show a first name to guests and to members not connected to a private reviewer', () => {
    const src = read('app/directory/[id]/page.tsx')
    expect(src).toMatch(/const reviewerName = session && !restrictedReviewers\.has\(r\.author\.id\) \? r\.author\.name : firstNameOf\(r\.author\.name\)/)
    expect(src).toMatch(/restrictedSetFor\(session, reviewsRaw\.map\(r => r\.author\)\)/)
    expect(src).not.toMatch(/truncate">\{r\.author\.name\}/)
  })
})

describe('one-off scripts', () => {
  it('fix-spots-left dry-runs by default and uses the app formula', () => {
    const src = read('scripts/fix-spots-left.ts')
    expect(src).toMatch(/const DRY_RUN = process\.env\.DRY_RUN !== '0'/)
    expect(src).toContain('expectedSpotsLeft(e.id, e.totalSpots)')
    expect(src).toMatch(/where: \{ id: e\.id, spotsLeft: e\.spotsLeft \}/)
  })
  it('reinvite-unactivated skips members it already re-invited', () => {
    const src = read('scripts/reinvite-unactivated.ts')
    expect(src).toMatch(/lastNudgedAt: null \}, \{ lastNudgedAt: \{ lt: /)
  })
  it('import-event-venues names the venue\'s own city', () => {
    const src = read('scripts/import-event-venues.ts')
    expect(src).not.toContain("?? 'Istanbul'")
    expect(src).toContain('cityName.get(evs[0].cityId)')
  })
})

describe('OG hangout image route', () => {
  it('renders only our own uploaded hangout photos', () => {
    const src = read('app/api/og/hangout/route.tsx')
    expect(src).toMatch(/isUploadedImageUrl\(path, \['hangouts'\]\)/)
    expect(src).toMatch(/const photo = ownUploadedPhoto\(req\.nextUrl\.searchParams\.get\('photo'\) \|\| ''\)/)
  })
})
