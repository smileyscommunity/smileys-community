import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MEMBER_LISTING_CATEGORY_IDS } from '@/lib/listingCategories'

// Admin panel review, items 12–16 (2026-09-27).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('12. member counts count members', () => {
  it('retention, NPS and the home trend use the community-member rule', () => {
    const ret = read('app/api/admin/retention/route.ts')
    expect(ret).toContain('...COMMUNITY_MEMBER_WHERE,\n    joinedAt: { lt: day7ago },')
    expect(ret.match(/u\.password IS NOT NULL AND u\.role NOT IN \('admin', 'partner'\)/g)?.length).toBe(2)
    expect(read('app/api/admin/nps/route.ts')).toContain('prisma.user.count({ where: { ...COMMUNITY_MEMBER_WHERE, joinedAt: { lt: eligibilityCutoff() },')
    expect(read('app/api/admin/stats/route.ts')).toContain('prisma.user.count({ where: { ...COMMUNITY_MEMBER_WHERE, joinedAt: { gte: monthAgo }, ...inCity } }),')
  })
  it('the re-engagement draft describes the member\'s real history', () => {
    const src = read('app/api/admin/users/reengage/route.ts')
    expect(src).not.toContain("hasn't attended an event in over 90 days")
    expect(src).toContain('to a member ${situation}.')
  })
})

describe('13. marketplace settings are enforced', () => {
  it('one category list, the member-postable one', () => {
    expect(MEMBER_LISTING_CATEGORY_IDS).toEqual(['ROOMS', 'JOBS', 'SERVICES', 'BUY_SELL', 'FREE', 'WANTED', 'PETS'])
    expect(read('app/api/admin/settings/route.ts')).toContain('const LISTING_CATEGORIES = new Set(MEMBER_LISTING_CATEGORY_IDS)')
  })
  it('the create route checks open categories, expiry and the active cap', () => {
    const src = read('app/api/listings/route.ts')
    expect(src).toContain('!listingSettings.enabledCategories.includes(category)')
    expect(src).toContain('listingSettings.defaultExpiryDays ?? LISTING_SETTING_DEFAULTS.defaultExpiryDays')
    expect(src).toContain('if (activeNow >= maxActive) {')
  })
  it('the approval switch nothing honored is gone', () => {
    expect(read('app/admin/listings/page.tsx')).not.toContain('Require approval before publishing')
  })
})

describe('14. content edits show at once', () => {
  it('saving content refreshes the cached pages', () => {
    expect(read('app/api/admin/content/route.ts')).toContain("revalidatePath('/', 'layout')")
  })
})

describe('15. no dead ends for moderators', () => {
  it('member links follow the viewer\'s role', () => {
    expect(read('app/admin/standing/page.tsx')).toContain('href={memberHref(o.user.id, user?.role)}')
    expect(read('app/admin/audit/page.tsx')).toContain("if (targetType === 'user')  return memberHref(targetId, viewerRole)")
  })
  it('partners Delete is admin-only and role changes confirm', () => {
    const src = read('app/admin/partners/page.tsx')
    expect(src).toContain('{isAdminUser && (')
    expect(src).toContain('Make ${user.name} a partner account?')
  })
  it('report actions and triage use the queue\'s city rule', () => {
    expect(read('app/api/admin/moderation/[id]/route.ts')).toContain('const reportCity = isAdmin(session) ? null : await reportCityOf(report)')
    expect(read('app/api/admin/moderation/triage/route.ts')).toContain('const reportCity = isAdmin(session) ? null : await reportCityOf(report)')
  })
})

describe('16. staff actions are audited', () => {
  it('users PATCH audits the rest of an edit', () => {
    const src = read('app/api/admin/users/[id]/route.ts')
    for (const a of ["'user.unsuspend'", "'user.membership_change'", "'user.appeal_decision'", "'user.update'"]) expect(src).toContain(a)
  })
  it('hangouts, moving sales and suggestions', () => {
    expect(read('app/api/hangouts/[id]/route.ts')).toContain("'hangout.staff_remove'")
    expect(read('app/api/moving-sales/[id]/route.ts')).toContain("'moving_sale.staff_edit'")
    expect(read('app/api/admin/applications/route.ts')).toContain("'application.suggest'")
  })
})
