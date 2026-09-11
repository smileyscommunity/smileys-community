import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('reminders cron', () => {
  it('reads the event start on its city clock, not the process zone', () => {
    const src = read('app/api/admin/cron/reminders/route.ts')
    expect(src).toMatch(/const eventTime = eventStartsAt\(event, tzByCity\.get\(event\.cityId\) \?\? DEFAULT_TZ\)/)
    expect(src).not.toMatch(/new Date\(`\$\{event\.date\}T\$\{event\.time/)
  })
})

describe('photo attach never strands the spinner', () => {
  it.each([
    'app/(member)/hangouts/page.tsx',
    'app/(member)/messages/[userId]/page.tsx',
    'app/(member)/board/new/page.tsx',
    'components/ReportButton.tsx',
  ])('%s downscales inside the try and reports ImageUploadError', (file) => {
    const src = read(file)
    // every downscaleImage call sits after a `try {` and before its catch
    for (const m of src.matchAll(/await downscaleImage\(file\)/g)) {
      const before = src.slice(0, m.index)
      expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('setUploading(true)'))
    }
    expect(src).toMatch(/err instanceof ImageUploadError \? err\.message/)
  })
})

describe('campaigns', () => {
  const src = read('app/api/admin/campaigns/route.ts')
  it('the live cup keeps its slug and only an admin can delete a campaign', () => {
    expect(src).toMatch(/before\.slug === LIVE_CUP_SLUG\) \{\s*return NextResponse\.json\(\{ error: 'The live cup campaign keeps its slug'/)
    const del = src.slice(src.indexOf('export async function DELETE'))
    expect(del).toMatch(/if \(!session \|\| !isAdmin\(session\)\)/)
  })
})

describe('moderator-facing rosters mask email', () => {
  it.each([
    ['app/api/admin/retention/route.ts', /emailFor\(session, r\.email\)/],
    ['app/api/admin/listings/route.ts', /maskRows\(session, listings, 'user'\)/],
    ['app/api/admin/listings/[id]/route.ts', /maskRows\(session, \[listing\], 'user'\)\[0\]/],
    ['app/api/admin/moving-sales/route.ts', /maskRows\(session, sales, 'user'\)/],
    ['app/api/admin/messages/route.ts', /maskRows\(session, messages, 'user'\)/],
    ['app/api/admin/no-show/cards/route.ts', /maskRows\(session, cards, 'user'\)/],
    ['app/api/admin/directory/route.ts', /maskRows\(session, businesses, 'submittedBy'\)/],
    ['app/api/admin/directory/claims/route.ts', /maskRows\(session, claims, 'claimant'\)/],
    ['app/api/admin/directory/reports/route.ts', /maskRows\(session, reports, 'reporter'\)/],
  ])('%s', (file, re) => {
    expect(read(file)).toMatch(re)
  })
})

describe('default-city guide editor', () => {
  it('is gated on the default city like the neighborhood guides', () => {
    expect(read('app/api/admin/guide/route.ts')).toMatch(/canActInCity\(session, await getDefaultCityId\(\)\)/)
  })
})

describe('analytics city scope', () => {
  const src = read('app/api/admin/analytics/route.ts')
  it('cohort denominator and "today" follow the selected city', () => {
    expect(src).toMatch(/todayInCity\(cityId \?\? await resolveCityId\(session\)\)/)
    expect(src).toMatch(/where:\s*\{ status: 'approved', role: \{ in: \['member', 'moderator'\] \}, \.\.\.userCity \}/)
  })
})

describe('newsletter send', () => {
  const src = read('app/api/admin/newsletter/route.ts')
  it('records the outcome after the batch, and a zero-sent blast is an error', () => {
    expect(src).toMatch(/sentById: session\.id, status: 'sending' \}/)
    expect(src).toMatch(/const outcome = sent > 0 \? 'sent' : 'failed'/)
    expect(src).toMatch(/if \(sent === 0\) \{[\s\S]*?status: 502/)
    // the audit row is written after sendNewsletterBatch, not before
    expect(src.indexOf("'newsletter.send'")).toBeGreaterThan(src.indexOf('await sendNewsletterBatch('))
  })
})
