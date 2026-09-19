import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateProfileField } from '@/lib/profileFields'

// The profile review (2026-09-19). The profile API, the directory list and
// the page's <head> each showed a different amount of a member; the editor's
// save route copied most fields through unchecked; a member could edit the
// gender the abuse scans key on; an email change moved the login before the
// new address was proven. These pin the fixes.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('what a member sees of another', () => {
  const route = src('app/api/members/[id]/route.ts')

  it('three levels: full, member (public, not connected), locked (connections-only)', () => {
    expect(route).toContain("self || connected || privileged ? 'full'")
    expect(route).toContain(": user.profileVisibility === 'connections' ? 'locked'")
    // Locked is a card, not a 404, so a request from a private member can be accepted.
    expect(route).toContain("if (viewLevel === 'locked') {")
    expect(route).toContain('name: firstNameOf(user.name),')
  })

  it('contact details and work are for connections; neighbourhood only if listed', () => {
    expect(route).toContain('instagram:    fullAccess ? user.instagram : null,')
    expect(route).toContain('neighborhood: fullAccess || user.neighborhoodVisible ? user.neighborhood : null,')
    expect(route).toContain('.filter(c => fullAccess || !c.isPrivate)')
  })

  it('suspended and blocked are 404 for anyone but staff; hidden is unlisted, not unreachable', () => {
    expect(route).toContain('if (user.suspendedUntil && user.suspendedUntil > new Date()) {')
    expect(route).not.toContain('if (user.hiddenFromMembers')
    expect(route).toContain('if (await isBlockedEitherWay(session.id, id)) {')
  })

  it('no "someone viewed your profile" notification; staff and hosts leave no view', () => {
    expect(route).not.toContain('createNotification')
    expect(route).toContain('if (self || isAdminOrModerator(session as never)) return')
    expect(route).toContain('viewer.hiddenFromMembers || await isClubHost(session.id)')
  })

  it('rate limit is per member, and "hosting now" means started', () => {
    expect(route).toContain('rateLimit(`member-profile:${session.id}`')
    expect(route).toContain("startsAt: { lte: new Date() }, endsAt: { gte: new Date() }")
  })

  it('the page head carries nothing personal', () => {
    const page = src('app/(member)/members/[id]/page.tsx')
    expect(page).not.toContain('prisma')
    expect(page).toContain("title: 'Member profile — Smileys Community'")
  })

  it('name search can\'t confirm a locked member\'s surname; mentions show them as their card does', () => {
    const priv = src('lib/memberPrivacy.ts')
    expect(priv).toContain("...(/\\s/.test(q) ? [] : [{ profileVisibility: 'connections', name: { startsWith: q, mode: 'insensitive' as const } }]),")
    for (const p of ['app/api/members/route.ts', 'app/api/search/route.ts', 'app/api/members/search/route.ts']) {
      expect(src(p)).toContain('await nameSearchWhere(session, ')
    }
    expect(src('app/api/members/search/route.ts')).toContain('photo:      restricted.has(u.id) ? null : u.profilePhoto,')
    // Filters on fields a locked card hides don't match locked members.
    expect(src('app/api/members/route.ts')).toContain('const filtersHidden = !!(openTo || lookingFor || speaksMyLang || aroundNow)')
  })

  it('the directory list shows a locked member the same way', () => {
    const list = src('app/api/members/route.ts')
    expect(list).toContain('id: m.id, name: firstNameOf(m.name), color: m.color, bio: null,')
    expect(list).toContain('profilePhoto: null, joinedAt: m.joinedAt,')
    expect(list).toContain('.filter(cm => full || !cm.club.isPrivate)')
    expect(list).toContain('{ OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }] }')
  })

  it('shared context skips invisible RSVPs, dead clubs and unlisted neighbourhoods', () => {
    const lib = src('lib/sharedContext.ts')
    expect(lib).toContain("status: 'approved', stealth: false,")
    expect(lib).toContain('club: { isActive: true }')
    expect(lib).toContain('m.neighborhoodVisible && m.neighborhood === viewer.neighborhood')
  })

  it('references: named the way their authors are shown anywhere else; no rating across a block', () => {
    const refs = src('app/api/members/[id]/references/route.ts')
    expect(refs).toContain('const show = await authorProjector(session, refs.map(r => r.fromUser))')
    expect(refs).toContain('fromUserId: { notIn: blockedIds },')
    expect(src('app/api/hangouts/[id]/references/route.ts')).toContain('if (await isBlockedEitherWay(session.id, body.toUserId)) {')
  })
})

describe('saving your own profile', () => {
  const v = (k: string, x: unknown) => validateProfileField(k, x)

  it('colour is a hex colour', () => {
    expect(v('color', '#A1b2C3')).toEqual({ ok: true, value: '#a1b2c3' })
    expect(v('color', 'red;background:url(x)').ok).toBe(false)
  })

  it('gender and visibility are closed sets', () => {
    expect(v('gender', 'non_binary').ok).toBe(true)
    expect(v('gender', 'Male').ok).toBe(false)
    expect(v('profileVisibility', 'connections').ok).toBe(true)
    expect(v('profileVisibility', 'nobody').ok).toBe(false)
  })

  it('lists are bounded, trimmed and de-duplicated', () => {
    expect(v('interests', [' Hiking ', 'hiking', 'Yoga'])).toEqual({ ok: true, value: ['Hiking', 'Yoga'] })
    expect(v('interests', Array.from({ length: 30 }, (_, i) => `i${i}`)).ok).toBe(true)
    expect(v('interests', Array.from({ length: 31 }, (_, i) => `i${i}`)).ok).toBe(false)
    expect(v('languages', ['x'.repeat(51)]).ok).toBe(false)
    expect(v('interests', 'Hiking').ok).toBe(false)
    expect(v('socialStyles', ['deep_talker', 'connector']).ok).toBe(true)
    // Retired ids are dropped rather than blocking the save.
    expect(v('socialStyles', ['deep_talker', 'made_up'])).toEqual({ ok: true, value: ['deep_talker'] })
    expect(v('socialStyles', ['deep_talker', 'connector', 'initiator', 'laid_back']).ok).toBe(false)
    expect(v('lookingFor', ['friendship', 'dating'])).toEqual({ ok: true, value: ['friendship'] })
    expect(v('lookingFor', 'friendship').ok).toBe(false)
  })

  it('Instagram links become handles; LinkedIn takes what /apply takes', () => {
    expect(v('instagram', 'https://www.instagram.com/some.one/?hl=en')).toEqual({ ok: true, value: 'some.one' })
    expect(v('instagram', 'evil.com/x').ok).toBe(false)
    expect(v('instagram', '')).toEqual({ ok: true, value: null })
    expect(v('linkedin', 'https://www.linkedin.com/in/' + 'a'.repeat(150)).ok).toBe(true)
    expect(v('linkedin', 'a'.repeat(201)).ok).toBe(false)
  })

  it('a gender change is on the record; the route returns what it saved', () => {
    const me = src('app/api/auth/me/route.ts')
    expect(me).toContain("'member.gender_changed'")
    expect(me).toContain('const checked = validateProfileField(key, body[key])')
    expect(me).toContain('ok: true,\n      user: {')
  })

  it('/me no longer signs anyone out on a database error', () => {
    const me = src('app/api/auth/me/route.ts')
    const get = me.slice(me.indexOf('export async function GET'), me.indexOf('export async function PATCH'))
    const katch = get.slice(get.lastIndexOf('} catch'))
    expect(katch).not.toContain('deleteSession')
  })

  it('own counts are events actually attended and clubs actually joined', () => {
    const me = src('app/api/auth/me/route.ts')
    expect(me).toContain("userId, status: 'approved', attendance: { not: 'no_show' },")
    expect(me).toContain("prisma.clubMembership.count({ where: { userId, status: 'approved', club: { isActive: true } } })")
  })
})

describe('abuse scans read the gender a member applied with', () => {
  it('both scans join lib/scanGender and flag anyone who isn\'t female', () => {
    const cte = src('lib/scanGender.ts')
    expect(cte).toContain('COALESCE(a.gender, e.gender, NULLIF(lower(trim(u.gender)), \'\'))')
    const route = src('app/api/admin/users/connection-flags/route.ts')
    expect(route).toContain('WITH ${SCAN_GENDER_CTE}')
    expect(route).not.toContain('lower(trim(qu.gender))')
    const script = src('scripts/scan-connection-abuse.ts')
    expect(script.match(/WITH \$\{SCAN_GENDER_CTE\}/g)).toHaveLength(2)
    expect(script).not.toContain("x.gender === 'male'")
    expect(script.match(/x\.gender !== 'female'/g)).toHaveLength(2)
  })
})

describe('changing your login email', () => {
  it('waits for the new address to confirm', () => {
    const req = src('app/api/auth/update-email/route.ts')
    expect(req).not.toMatch(/data:\s*\{ email: newEmail/)
    expect(req).toContain('prisma.emailVerificationToken.create({ data: { userId: session.id, token: hashToken(token), expiresAt, newEmail, tokenVersion: user.tokenVersion } })')
    const verify = src('app/api/auth/verify-email/route.ts')
    expect(verify).toContain('if (record.newEmail) return applyEmailChange(record.userId, record.newEmail, record.tokenVersion, hashed)')
    // Dies with any sign-out-everywhere (password change or reset, ban) since it was asked.
    expect(verify).toContain('askedAtVersion === null || askedAtVersion !== user.tokenVersion')
    expect(verify).toContain('where: { id: userId, tokenVersion: askedAtVersion },')
    // The session is read before the tokenVersion bump, or the confirming browser is signed out.
    expect(verify.indexOf('const session = await getSession()')).toBeLessThan(verify.indexOf('tokenVersion: { increment: 1 }'))
  })
})
