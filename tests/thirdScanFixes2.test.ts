import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { isSafeHref, safeReturnPath } from '@/lib/safeUrl'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('11 database backup', () => {
  it('dumps to a .part file and renames only after the size check', () => {
    const src = read('scripts/db-backup.sh')
    expect(src).toMatch(/if ! pg_dump -U smileys -h localhost smileys_db \| gzip > "\$PART"; then/)
    expect(src).toMatch(/mv "\$PART" "\$FILE"/)
    expect(src.indexOf('mv "$PART" "$FILE"')).toBeGreaterThan(src.indexOf('Backup too small'))
  })
})

describe('12 deploy health check', () => {
  it('polls the restarted process and fails the deploy if it never answers 200', () => {
    const src = read('deploy.sh')
    expect(src).toMatch(/Health check on the restarted process/)
    expect(src).toMatch(/http:\/\/localhost:3000\/app\/api\/health/)
    expect(src).toMatch(/Health check FAILED[\s\S]*?exit 1/)
    expect(src.indexOf('Health check on the restarted process')).toBeLessThan(src.indexOf('Pruning retained chunks'))
  })
})

describe('13 URL validator', () => {
  it('rejects a backslash path, which browsers resolve off-origin', () => {
    expect(isSafeHref('/\\evil.com')).toBe(false)
    expect(isSafeHref('/events\\x')).toBe(false)
    expect(safeReturnPath('/\\evil.com')).toBeNull()
    expect(isSafeHref('/events/abc')).toBe(true)
    expect(safeReturnPath('/events/abc')).toBe('/events/abc')
  })
})

describe('14 host UI offers only what the API allows', () => {
  it('rules editor is staff-only in the host console', () => {
    expect(read('app/host/clubs/[slug]/ClubManagementTabs.tsx')).toMatch(/<ClubRulesEditor slug=\{slug\} initialRules=\{initialRules\} canEdit=\{isAdmin\} dark \/>/)
  })
  it('no Publish action on the host list; the edit select only keeps published for a published event', () => {
    const list = read('app/host/events/page.tsx')
    expect(list).not.toMatch(/label: 'Publish'/)
    expect(list).toMatch(/toast\.error\(\(await res\.json\(\)\.catch\(\(\) => \(\{\}\)\)\)\?\.error \?\? 'Failed to update status'\)/)
    // Keyed on the status as loaded, so a host who picks Draft can still switch back.
    expect(read('app/host/events/[id]/edit/page.tsx')).toMatch(/\{\(loadedStatus === 'published' \|\| isStaff\) && <option value="published">/)
  })
  it('the club picker keys on /api/auth/me, not on the city-host club list', () => {
    expect(read('app/host/events/[id]/edit/page.tsx')).toMatch(/const isClubHost = \(viewer as \{ isClubHost\?: boolean \} \| null\)\?\.isClubHost === true/)
  })
})

describe('15 "today" on the city calendar', () => {
  it('check-in page derives its list from the resolved zone', () => {
    expect(read('app/host/checkin/page.tsx')).toMatch(/const events = useMemo\(\(\) => \{[\s\S]*?\}, \[all, tz\]\)/)
  })
  it('club page, visiting, guide, shared context, first-event, nudge, mini calendar', () => {
    expect(read('app/(member)/clubs/[slug]/page.tsx')).toMatch(/const today = club\.cityId \? await todayInCity\(club\.cityId\) : todayInTz\(DEFAULT_TZ\)/)
    expect(read('app/(member)/clubs/[slug]/page.tsx')).toMatch(/Date\.parse\(next\.date \+ 'T00:00:00Z'\) - Date\.parse\(today \+ 'T00:00:00Z'\)/)
    expect(read('app/visiting/page.tsx')).toMatch(/const today\s*= todayInTz\(city\.timezone\)/)
    expect(read('app/guide/page.tsx')).toMatch(/const today = todayInTz\(city\.timezone\)/)
    expect(read('lib/sharedContext.ts')).toMatch(/const today = viewer\.today/)
    expect(read('lib/firstEvent.ts')).toMatch(/const todayStr = await todayInCity\(user\.cityId\)/)
    expect(read('lib/firstRsvpNudge.ts')).toMatch(/zones\.map\(tz => todayInTz\(tz, 1\)\)\.sort\(\)\[0\]/)
    expect(read('components/MiniCalendar.tsx')).toMatch(/const todayStr = todayInTz\(tz\)/)
    expect(read('app/(member)/dashboard/page.tsx')).toContain('<MiniCalendar eventDates={upcomingDates} tz={tz} />')
  })
  it('no surface in the set still asks UTC for today', () => {
    for (const f of ['app/(member)/clubs/[slug]/page.tsx', 'app/visiting/page.tsx', 'app/guide/page.tsx', 'lib/sharedContext.ts', 'components/MiniCalendar.tsx', 'app/(member)/events/[id]/recap/page.tsx']) {
      expect(read(f)).not.toMatch(/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/)
    }
  })
})
