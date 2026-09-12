import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('33 search and discovery', () => {
  it('palette search and the neighborhoods strip exclude hidden accounts', () => {
    expect(read('app/api/search/route.ts')).toMatch(/status: 'approved',\s*hiddenFromMembers: false,\s*cityId,/)
    expect(read('app/neighborhoods/page.tsx')).toMatch(/neighborhoodVisible: true,\s*hiddenFromMembers: false,/)
  })
  it('mention autocomplete is city-scoped, block-aware and rate-limited', () => {
    const src = read('app/api/members/search/route.ts')
    expect(src).toMatch(/rateLimit\(`member-search:\$\{session\.id\}`/)
    expect(src).toMatch(/cityId: await resolveCityId\(session\)/)
    expect(src).toMatch(/id:\s*\{ notIn: \[session\.id, \.\.\.blockedIds\] \}/)
  })
})

describe('34 partner images', () => {
  it('must be uploads (an external URL is a tracking pixel on /perks)', () => {
    const src = read('app/api/partner/route.ts')
    expect(src).toMatch(/if \(v && !isUploadedImageUrl\(v\)\) return NextResponse\.json\(\{ error: `\$\{key\} must be an image uploaded through Smileys`/)
    // …but a value the settings page merely echoed back is not re-validated.
    expect(src).toMatch(/if \(\(v \|\| null\) === \(current\?\.\[key\] \|\| null\)\) continue/)
  })
})

describe('35 push subscribe', () => {
  it('requires an https endpoint and key-shaped keys', () => {
    const src = read('app/api/push/subscribe/route.ts')
    // Superseded by the push-service allowlist (third scan, item 4).
    expect(src).toMatch(/!isPushServiceEndpoint\(endpoint\)/)
    expect(src).toMatch(/const isKey = \(v: unknown\) => typeof v === 'string' && \/\^\[A-Za-z0-9_-\]\{16,512\}\$\/\.test\(v\)/)
  })
})

describe('36 visitors', () => {
  it('excludes blocked pairs for members', () => {
    expect(read('app/api/visitors/route.ts')).toMatch(/OR: \[\{ userId: null \}, \{ userId: \{ notIn: blockedIds \} \}\]/)
  })
})

describe('37 neighborhood of a connections-only member', () => {
  it('is withheld without a connection on the list, profile views, connections and search', () => {
    expect(read('app/api/members/route.ts')).toMatch(/neighborhood: null, nationality: null,/)
    expect(read('app/api/members/profile-views/route.ts')).toMatch(/neighborhood: restricted\.has\(v\.viewer\.id\) \? null : v\.viewer\.neighborhood/)
    expect(read('app/api/connections/route.ts')).toMatch(/restricted\.has\(p\.id\) \? \{ \.\.\.rest, neighborhood: null \} : rest/)
    expect(read('app/api/search/route.ts')).toMatch(/neighborhood: restricted\.has\(m\.id\) \? null : m\.neighborhood/)
  })
})

describe('38 wall images', () => {
  it('use the shared validator', () => {
    expect(read('app/api/neighborhoods/[slug]/posts/route.ts')).toMatch(/if \(imageUrl && !isUploadedImageUrl\(imageUrl\)\)/)
  })
})

describe('39 hangout edges', () => {
  it('no references on a cancelled hangout; a moved start re-arms the ping', () => {
    expect(read('app/api/hangouts/[id]/references/route.ts')).toMatch(/ctx\.hangout\.status === 'cancelled'/)
    expect(read('app/api/hangouts/[id]/route.ts')).toMatch(/if \(startDate\.getTime\(\) !== hangout\.startsAt\.getTime\(\)\) data\.notifiedStartingAt = null/)
  })
  it('the nudge clears only expired tokens; hosts hear about stamped cards; no-shows get no survey', () => {
    expect(read('app/api/cron/sweep-login-nudge/route.ts')).toMatch(/deleteMany\(\{ where: \{ userId: user\.id, expiresAt: \{ lt: now \} \} \}\)/)
    expect(read('lib/noShow.ts')).toMatch(/await notifyHosts\(notified\)/)
    expect(read('app/api/cron/sweep-event-surveys/route.ts')).toMatch(/NOT: \{ attendance: 'no_show' \}/)
  })
})

describe('40 email details', () => {
  const email = read('lib/email.ts')
  it('text part uses the raw first name; nudge subject is sanitised; dates are readable', () => {
    expect(email).toMatch(/text:\s*`Hi \$\{firstNameRaw\},/)
    expect(email).toMatch(/subject: safeSubject\(`\$\{ev\.emoji \? ev\.emoji \+ ' ' : ''\}\$\{ev\.title\} — your first Smileys event\?`\)/)
    expect((email.match(/\$\{esc\(prettyEventDate\(eventDate\)\)\}/g) ?? []).length).toBe(4)
  })
  it('admin event mails judge the day on the event city; bulk alerts go to approved members; quiet hours with equal bounds are off', () => {
    expect(read('app/api/admin/events/[id]/remind-attendees/route.ts')).toMatch(/await todayInCity\(event\.cityId\)/)
    expect(read('app/api/admin/events/[id]/notify-noshows/route.ts')).toMatch(/await todayInCity\(event\.cityId\)/)
    expect(read('app/api/admin/listings/bulk/route.ts')).toMatch(/cityId: listingCityId, status: 'approved' \}/)
    expect(read('lib/notify.ts')).toMatch(/if \(from === to\) return false/)
  })
  it.each([
    'app/api/apply/route.ts', 'app/api/admin/applications/route.ts', 'app/api/admin/users/[id]/route.ts',
    'app/api/admin/cron/reminders/route.ts', 'app/api/auth/resend-verification/route.ts',
    'app/api/auth/update-email/route.ts', 'app/api/directory/route.ts',
  ])('%s records email failures', (file) => {
    const src = read(file)
    expect(src).not.toMatch(/Email\([^)]*\)\.catch\(console\.error\)/)
    expect(src).toMatch(/recordEmailFailure\(\{ helper:/)
  })
})

describe('41 admin hygiene', () => {
  it('raw error text stays in the log', () => {
    for (const f of ['app/api/admin/cup/results/refresh/route.ts', 'app/api/admin/tools/login-nudge/route.ts', 'app/api/admin/campaigns/[id]/donations/route.ts']) {
      expect(read(f)).not.toMatch(/error: \(e as Error\)\.message/)
    }
  })
  it('blacklist add, announcement and spotlight writes are audited', () => {
    expect(read('app/api/admin/blacklist/route.ts')).toMatch(/'blacklist\.add'/)
    expect(read('app/api/admin/announcement/route.ts')).toMatch(/'announcement\.set'/)
    expect(read('app/api/admin/spotlight/route.ts')).toMatch(/'spotlight\.set'/)
  })
  it('retention cutoff and stats buckets follow the city calendar', () => {
    expect(read('app/api/admin/retention/route.ts')).toMatch(/dayInTz\(day60ago, cityId \? await getCityTz\(cityId\) : DEFAULT_TZ\)/)
    expect(read('app/api/admin/stats/route.ts')).toMatch(/const todayStart = fromWallClockInTz\(`\$\{todayStr\}T00:00`, tz\)/)
  })
})

describe('42 client hygiene', () => {
  it('withdraw checks its response and block has an error path', () => {
    const src = read('app/(member)/members/[id]/MemberProfileClient.tsx')
    expect(src).toMatch(/if \(!res\.ok\) \{ toast\.error\('Could not withdraw the request/)
    expect(src).toMatch(/async function handleBlock\(\) \{\s*setBlocking\(true\)\s*try \{/)
  })
  it('password change and push enable recover from a failed request', () => {
    const src = read('app/(member)/settings/page.tsx')
    expect(src).toMatch(/setPwError\('Could not reach the server — try again'\)/)
    expect(src).toMatch(/toast\.error\('Could not turn on push notifications — try again'\)/)
  })
  it('storage reads are guarded in the root-layout prompt and the cup page', () => {
    const ip = read('components/InstallPrompt.tsx')
    expect(ip).not.toMatch(/(?<!try \{ return )localStorage\.getItem/)
    expect(read('app/(member)/cup/page.tsx')).toMatch(/try \{ dismissed = localStorage\.getItem\(CUP_PUSH_DISMISS_KEY\)/)
  })
  it('drag-drop, invite stats, accept/decline and dashboard windows', () => {
    expect(read('components/ImageUpload.tsx')).toMatch(/\}, \[folder, handleFile\]\)/)
    expect(read('app/(member)/invite/page.tsx')).toMatch(/\.finally\(\(\) => setLoading\(false\)\)/)
    expect(read('app/(member)/members/page.tsx')).toMatch(/disabled=\{pendingBusyIds\.has\(req\.id\)\}/)
    expect(read('app/(member)/dashboard/page.tsx')).toMatch(/const weekEndStr\s*= shiftDay\(today, 7\)/)
  })
})
