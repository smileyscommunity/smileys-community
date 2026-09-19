import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Admin users / retention review, 2026-09-19:
//   1. PATCH responses are a narrow select — never the password hash, TOTP
//      secret or fingerprints — and the detail page merges them in
//   2. Quick Edit loads what it edits, sends only changes, saves the
//      professional fields, and doesn't re-validate an untouched neighborhood
//   3. moderators nudge their own city's members (draft + send), deduped
//   4. list and detail count the same no-shows: approved + attendance no_show
//   5. unbanning removes the blacklist row the ban created
//   6. a never-activated member gets the activation resend
//   7–9. detail-page and list-page smaller fixes, moderator-safe member links

const h = vi.hoisted(() => {
  const calls: Record<string, any[]> = {}
  const results: Record<string, any> = {}
  const client = (): any => new Proxy({}, { get: (_t, m: string) => {
    if (m === '$transaction') return (ops: any) => (typeof ops === 'function' ? ops(client()) : Promise.all(ops))
    return new Proxy({}, { get: (_t2, method: string) => (...args: any[]) => {
      const key = `${m}.${method}`
      ;(calls[key] ??= []).push(args[0])
      if (key in results) return Promise.resolve(typeof results[key] === 'function' ? results[key](args[0]) : results[key])
      if (method === 'count') return Promise.resolve(0)
      if (method === 'findMany' || method === 'groupBy') return Promise.resolve([])
      if (method === 'findUnique' || method === 'findFirst') return Promise.resolve(null)
      if (method === 'deleteMany' || method === 'updateMany') return Promise.resolve({ count: 0 })
      return Promise.resolve({})
    } })
  } })
  return {
    prisma: client(), calls, results,
    getSession:         vi.fn(),
    writeAudit:         vi.fn(async () => {}),
    createNotification: vi.fn(async () => true),
    rateLimit:          vi.fn(async () => true),
    claimOnce:          vi.fn(async () => true),
    releaseClaim:       vi.fn(async () => {}),
    normalize:          vi.fn(async (_c: string, v: string) => ({ ok: true, value: v })),
    openaiCreate:       vi.fn(async () => ({ choices: [{ message: { content: 'We would love to see you.' } }] })),
  }
})

vi.mock('@/lib/prisma',            () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',           () => ({ getSession: h.getSession }))
vi.mock('@/lib/audit',             () => ({ writeAudit: h.writeAudit, getDiff: vi.fn(() => ({})) }))
vi.mock('@/lib/notify',            () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/rateLimit',         () => ({ rateLimit: h.rateLimit, claimOnce: h.claimOnce, releaseClaim: h.releaseClaim, getIp: vi.fn(() => '1.2.3.4') }))
vi.mock('@/lib/email',             () => ({ sendPremiumUpgradeEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
vi.mock('@/lib/neighborhoodsDb',   () => ({ normalizeNeighborhoodInput: h.normalize }))
vi.mock('@/lib/survey',            () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()), aggregateRollup: vi.fn(() => null) }))
vi.mock('@/lib/spotsLeft',         () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/city',              () => ({ todayInCity: vi.fn(async () => '2026-09-19'), resolveCityId: vi.fn(async () => 'c-ist') }))
vi.mock('@/lib/admin/userHistory', () => ({ snapshotUserHistory: vi.fn(async () => ({})) }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: h.openaiCreate } } } }))

import { GET as detailGET, PATCH as detailPATCH } from '@/app/api/admin/users/[id]/route'
import { GET as listGET } from '@/app/api/admin/users/route'
import { POST as draftPOST } from '@/app/api/admin/users/reengage/route'
import { mayReengage } from '@/app/api/admin/users/reengage/gate'
import { memberHref, isModeratorPageAllowed, navItems } from '@/lib/adminNav'

const read = (p: string) => readFileSync(p, 'utf8')
const all  = (key: string) => h.calls[key] ?? []
const jsonReq = (body: any = {}, url = 'https://x/app/api/admin/users/u1') =>
  ({ json: async () => body, url, headers: new Headers() }) as any
const params = { params: Promise.resolve({ id: 'u1' }) }

const admin = { id: 'a1', name: 'Admin', email: 'a@x', role: 'admin', cityId: 'c-ist', color: '#000', totpVerified: true }
const modIst = { id: 'm1', name: 'Mod', email: 'm@x', role: 'moderator', cityId: 'c-ist', color: '#000' }
const modTbs = { ...modIst, id: 'm2', cityId: 'c-tbs' }

const target = (over: Record<string, unknown> = {}) => ({
  role: 'member', status: 'approved', name: 'Jane', email: 'jane@x.com', phone: '+905321234567',
  suspendedUntil: null, cityId: 'c-ist', membershipType: 'free', neighborhood: 'Moda', bannedAt: null, ...over,
})

const SECRET_FIELDS = ['password', 'totpSecret', 'lastFingerprint', 'fingerprints', 'knownIps', 'tokenVersion', 'lastUsedTotpStep']

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.calls)) delete h.calls[k]
  for (const k of Object.keys(h.results)) delete h.results[k]
  h.createNotification.mockResolvedValue(true)
  h.rateLimit.mockResolvedValue(true)
  h.claimOnce.mockResolvedValue(true)
})

// ── 1. narrow PATCH responses ──────────────────────────────────────────────
describe('1. user PATCH never hands back secrets', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue(admin)
    h.results['user.findUnique'] = (args: any) => args.where.id ? target() : null
  })

  it('every update selects a fixed field list without the password, TOTP secret or fingerprints', async () => {
    for (const body of [{ bio: 'hi' }, { role: 'moderator' }, { status: 'banned', banReason: 'spam' }, { email: 'new@y.com' }]) {
      expect((await detailPATCH(jsonReq(body), params)).status).toBe(200)
    }
    const updates = all('user.update')
    expect(updates).toHaveLength(4)
    for (const u of updates) {
      expect(u.select).toBeTruthy()
      expect(u.select.joinedEvents).toBeUndefined()
      for (const f of SECRET_FIELDS) expect(u.select[f], f).toBeUndefined()
    }
  })

  it('the no-op path (email re-sent unchanged) reads back through the same select', async () => {
    expect((await detailPATCH(jsonReq({ email: 'JANE@x.com' }), params)).status).toBe(200)
    const readBack = all('user.findUnique').at(-1)   // after the target lookup
    expect(all('user.findUnique')).toHaveLength(2)
    expect(readBack.select.password).toBeUndefined()
    expect(readBack.select.email).toBe(true)
    expect(all('user.update')).toHaveLength(0)
  })

  it('the detail page merges the response instead of replacing its state', () => {
    const src = read('app/admin/users/[id]/page.tsx')
    expect(src).not.toMatch(/const updated = await res\.json\(\)\s*\n\s*setUser\(updated\)/)
    expect(src).toContain('setUser(u => u ? { ...u, ...saved } : null)')
  })
})

// ── 2. Quick Edit ──────────────────────────────────────────────────────────
describe('2. Quick Edit loads and saves what it shows', () => {
  it('GET loads partner + professional fields, suspension and warnings, and says hasPassword without the hash', async () => {
    h.getSession.mockResolvedValue(admin)
    h.results['user.findUnique'] = (args: any) => args.select?.joinedEvents
      ? { id: 'u1', name: 'Jane', email: 'jane@x.com', phone: null, cityId: 'c-ist', password: '$2b$hash', adminNotes: [], joinedEvents: [], partnerId: 'p1', industry: 'Tech' }
      : null
    h.results['payment.groupBy'] = [{ currency: 'TRY', _sum: { amount: 500 } }, { currency: 'GEL', _sum: { amount: 40 } }]
    const res = await detailGET(jsonReq(), params)
    const body = await res.json()
    const sel = all('user.findUnique')[0].select
    for (const f of ['partnerId', 'industry', 'professionalRole', 'professionalStatus', 'warningCount', 'suspendedUntil', 'suspensionNote']) {
      expect(sel[f], f).toBe(true)
    }
    expect(body.password).toBeUndefined()
    expect(body.hasPassword).toBe(true)
    expect(body.partnerId).toBe('p1')
    expect(body.paidTotals).toEqual([{ currency: 'TRY', amount: 500 }, { currency: 'GEL', amount: 40 }])
    expect(all('payment.groupBy')[0].where).toEqual({ userId: 'u1', status: 'paid' })
  })

  it('moderators get no payment totals', async () => {
    h.getSession.mockResolvedValue(modIst)
    h.results['user.findUnique'] = (args: any) => args.select?.joinedEvents
      ? { id: 'u1', name: 'Jane', email: 'jane@x.com', phone: null, cityId: 'c-ist', password: null, adminNotes: [], joinedEvents: [] }
      : null
    const body = await (await detailGET(jsonReq(), params)).json()
    expect(body.paidTotals).toBeNull()
    expect(body.hasPassword).toBe(false)
    expect(all('payment.groupBy')).toHaveLength(0)
  })

  describe('PATCH', () => {
    beforeEach(() => {
      h.getSession.mockResolvedValue(admin)
      h.results['user.findUnique'] = (args: any) => args.where.id ? target({ neighborhood: 'Legacy Place' }) : null
    })

    it('saves the professional fields, normalised like the member profile route', async () => {
      const res = await detailPATCH(jsonReq({ industry: ' Tech ', professionalRole: 'Founder', professionalStatus: 'hiring' }), params)
      expect(res.status).toBe(200)
      expect(all('user.update')[0].data).toMatchObject({ industry: 'Tech', professionalRole: 'Founder', professionalStatus: 'hiring' })
    })

    it('clears them with an empty value and rejects an unknown networking goal', async () => {
      expect((await detailPATCH(jsonReq({ industry: '', professionalStatus: '' }), params)).status).toBe(200)
      expect(all('user.update')[0].data).toMatchObject({ industry: null, professionalStatus: null })
      expect((await detailPATCH(jsonReq({ professionalStatus: 'influencer' }), params)).status).toBe(400)
      expect((await detailPATCH(jsonReq({ professionalRole: 'x'.repeat(61) }), params)).status).toBe(400)
    })

    it('an unchanged legacy neighborhood is not re-validated (it used to 400 every save)', async () => {
      h.normalize.mockResolvedValueOnce({ ok: false, error: 'Unknown neighborhood' } as any)
      const res = await detailPATCH(jsonReq({ neighborhood: 'Legacy Place', bio: 'hi' }), params)
      expect(res.status).toBe(200)
      expect(h.normalize).not.toHaveBeenCalled()
      expect(all('user.update')[0].data.neighborhood).toBeUndefined()
    })

    it('a changed neighborhood still is', async () => {
      h.normalize.mockResolvedValueOnce({ ok: false, error: 'Unknown neighborhood' } as any)
      expect((await detailPATCH(jsonReq({ neighborhood: 'Atlantis' }), params)).status).toBe(400)
      expect(h.normalize).toHaveBeenCalledWith('c-ist', 'Atlantis')
    })

    it('an unknown partner is a 400, not a foreign-key 500; null unlinks', async () => {
      expect((await detailPATCH(jsonReq({ partnerId: 'nope' }), params)).status).toBe(400)
      expect((await detailPATCH(jsonReq({ partnerId: null }), params)).status).toBe(200)
      expect(all('user.update').at(-1).data).toEqual({ partnerId: null })
      h.results['partner.findUnique'] = { id: 'p1' }
      expect((await detailPATCH(jsonReq({ partnerId: 'p1' }), params)).status).toBe(200)
    })

    it('moderators still cannot edit profile fields', async () => {
      h.getSession.mockResolvedValue(modIst)
      expect((await detailPATCH(jsonReq({ industry: 'Tech' }), params)).status).toBe(403)
    })
  })

  it('the page sends only the fields that differ from what it loaded', () => {
    const src = read('app/admin/users/[id]/page.tsx')
    expect(src).toContain('.filter(k => profileForm[k] !== profileBaseline[k])')
    expect(src).toContain('body: JSON.stringify(body),')
    expect(src).not.toMatch(/\.\.\.profileForm,\s*\n\s*languages:/)
  })
})

// ── 3. moderator nudges ────────────────────────────────────────────────────
describe('3. retention nudges work for moderators in their own city', () => {
  it('the gate: admin anywhere, moderator own city only, fails closed without a city', () => {
    expect(mayReengage(admin as any, 'c-tbs')).toBe(true)
    expect(mayReengage(modIst as any, 'c-ist')).toBe(true)
    expect(mayReengage(modIst as any, 'c-tbs')).toBe(false)
    expect(mayReengage(modIst as any, null)).toBe(false)
    expect(mayReengage({ ...modIst, cityId: null } as any, 'c-ist')).toBe(false)
    expect(mayReengage({ ...modIst, role: 'member' } as any, 'c-ist')).toBe(false)
  })

  describe('send (PATCH _reengage)', () => {
    beforeEach(() => {
      h.results['user.findUnique'] = (args: any) => args.where.id ? target() : null
    })

    it('a moderator sends to a member of their city, once, and it is audited', async () => {
      h.getSession.mockResolvedValue(modIst)
      const res = await detailPATCH(jsonReq({ _reengage: '  Come to a picnic  ' }), params)
      expect(res.status).toBe(200)
      expect(h.createNotification).toHaveBeenCalledWith('u1', 'announcement', '👋 We miss you!', 'Come to a picnic', '/events')
      expect(h.claimOnce).toHaveBeenCalledWith('reengage:u1', 7 * 24 * 60 * 60 * 1000)
      expect(h.writeAudit).toHaveBeenCalledWith('m1', 'Mod', 'user.reengage', 'u1', 'user', expect.objectContaining({ cityId: 'c-ist' }), expect.any(String))
    })

    it('another city\'s moderator is refused before anything is sent', async () => {
      h.getSession.mockResolvedValue(modTbs)
      expect((await detailPATCH(jsonReq({ _reengage: 'hi' }), params)).status).toBe(403)
      expect(h.createNotification).not.toHaveBeenCalled()
      expect(h.claimOnce).not.toHaveBeenCalled()
    })

    it('a member nudged this week is not nudged again', async () => {
      h.getSession.mockResolvedValue(modIst)
      h.claimOnce.mockResolvedValueOnce(false)
      const res = await detailPATCH(jsonReq({ _reengage: 'hi' }), params)
      expect(res.status).toBe(409)
      expect(h.createNotification).not.toHaveBeenCalled()
    })

    it('a failed write hands the week back', async () => {
      h.getSession.mockResolvedValue(admin)
      h.createNotification.mockResolvedValueOnce(false)
      expect((await detailPATCH(jsonReq({ _reengage: 'hi' }), params)).status).toBe(502)
      expect(h.releaseClaim).toHaveBeenCalledWith('reengage:u1')
    })

    it('empty, non-string and oversized messages are refused; the sender cap applies', async () => {
      h.getSession.mockResolvedValue(admin)
      expect((await detailPATCH(jsonReq({ _reengage: '   ' }), params)).status).toBe(400)
      expect((await detailPATCH(jsonReq({ _reengage: 42 }), params)).status).toBe(400)
      expect((await detailPATCH(jsonReq({ _reengage: 'x'.repeat(1001) }), params)).status).toBe(400)
      h.rateLimit.mockResolvedValueOnce(false)
      expect((await detailPATCH(jsonReq({ _reengage: 'hi' }), params)).status).toBe(429)
      expect(h.createNotification).not.toHaveBeenCalled()
    })
  })

  describe('draft (POST /reengage)', () => {
    const member = { name: 'Jane Doe', interests: ['hiking'], neighborhood: 'Moda', joinedAt: new Date(), cityId: 'c-ist', city: { name: 'Istanbul' } }

    it('a moderator drafts for their own city', async () => {
      h.getSession.mockResolvedValue(modIst)
      h.results['user.findUnique'] = member
      const res = await draftPOST(jsonReq({ userId: 'u1' }))
      expect(res.status).toBe(200)
      expect((await res.json()).message).toBe('We would love to see you.')
    })

    it('another city\'s member is a 404 and costs no model call', async () => {
      h.getSession.mockResolvedValue(modTbs)
      h.results['user.findUnique'] = member
      expect((await draftPOST(jsonReq({ userId: 'u1' }))).status).toBe(404)
      expect(h.openaiCreate).not.toHaveBeenCalled()
    })

    it('members are refused outright, and the draft cap applies', async () => {
      h.getSession.mockResolvedValue({ ...modIst, role: 'member' })
      expect((await draftPOST(jsonReq({ userId: 'u1' }))).status).toBe(403)
      h.getSession.mockResolvedValue(admin)
      h.results['user.findUnique'] = member
      h.rateLimit.mockResolvedValueOnce(false)
      expect((await draftPOST(jsonReq({ userId: 'u1' }))).status).toBe(429)
      expect(h.openaiCreate).not.toHaveBeenCalled()
    })
  })

  it('Retention is in the admin sidebar too, and still open to moderators', () => {
    const item = navItems.find(i => i.href === '/admin/retention')!
    expect(item.roles).toEqual(['admin', 'moderator'])
    expect(isModeratorPageAllowed('/admin/retention')).toBe(true)
  })
})

// ── 4. no-show counts ──────────────────────────────────────────────────────
describe('4. list and detail count the same no-shows', () => {
  it('the list counts approved rows settled as no_show — no UTC date, no checkedIn guess', async () => {
    h.getSession.mockResolvedValue(admin)
    h.results['user.findMany'] = [
      { id: 'u1', email: 'a@x.com', phone: null, password: 'h', name: 'A' },
      { id: 'u2', email: 'b@x.com', phone: null, password: null, name: 'B' },
    ]
    h.results['eventAttendee.groupBy'] = [{ userId: 'u1', _count: { _all: 3 } }]
    const res = await listGET(jsonReq({}, 'https://x/app/api/admin/users'))
    const rows = await res.json()
    expect(all('eventAttendee.groupBy')[0].where).toEqual({ status: 'approved', attendance: 'no_show' })
    expect(rows.find((r: any) => r.id === 'u1').noShowCount).toBe(3)
    expect(rows.find((r: any) => r.id === 'u2').noShowCount).toBe(0)
    expect(rows[0].password).toBeUndefined()
    expect(read('app/api/admin/users/route.ts')).not.toContain('toISOString().slice(0, 10)')
  })

  it('the detail page counts approved + attendance no_show too, never "past and not scanned"', () => {
    const src = read('app/admin/users/[id]/page.tsx')
    expect(src).toContain('approvedJoined.filter(je => je.attendance === Attendance.NoShow).length')
    expect(src).not.toContain('pastJoined.filter(je => !je.checkedIn)')
    expect(src).not.toMatch(/isPastEventDay\(je\.event\) \? 'No Show'/)
  })
})

// ── 5. unban clears the ban's blacklist row ────────────────────────────────
describe('5. unbanning removes the blacklist row the ban added', () => {
  const bannedAt = new Date('2026-09-10T10:00:00Z')

  beforeEach(() => { h.getSession.mockResolvedValue(admin) })

  it('deletes rows for the email created since the ban, and audits them', async () => {
    h.results['user.findUnique'] = (args: any) => args.where.id ? target({ status: 'banned', bannedAt }) : null
    h.results['blacklist.findMany'] = [{ id: 'b1', email: 'jane@x.com', phone: null, reason: 'spam', bannedBy: 'Admin', createdAt: bannedAt }]
    const res = await detailPATCH(jsonReq({ status: 'approved', banReason: null }), params)
    expect(res.status).toBe(200)
    expect(all('blacklist.findMany')[0].where).toEqual({
      email: { equals: 'jane@x.com', mode: 'insensitive' }, createdAt: { gte: bannedAt },
    })
    expect(all('blacklist.deleteMany')[0]).toEqual({ where: { id: { in: ['b1'] } } })
    expect(h.writeAudit).toHaveBeenCalledWith('a1', 'Admin', 'blacklist.remove', 'u1', 'user', expect.objectContaining({ reason: 'unban' }), expect.any(String))
  })

  it('an entry older than the ban is a separate decision and stays; so does a ban with no bannedAt', async () => {
    h.results['user.findUnique'] = (args: any) => args.where.id ? target({ status: 'banned', bannedAt: null }) : null
    expect((await detailPATCH(jsonReq({ status: 'approved' }), params)).status).toBe(200)
    expect(all('blacklist.findMany')).toHaveLength(0)
    expect(all('blacklist.deleteMany')).toHaveLength(0)
  })

  it('a ban leaves the blacklist alone on other edits', async () => {
    h.results['user.findUnique'] = (args: any) => args.where.id ? target({ status: 'banned', bannedAt }) : null
    expect((await detailPATCH(jsonReq({ bio: 'x' }), params)).status).toBe(200)
    expect(all('blacklist.findMany')).toHaveLength(0)
  })

  it('a self-deleted account cannot be unbanned', async () => {
    h.results['user.findUnique'] = (args: any) => args.where.id ? target({ status: 'banned', bannedAt, email: 'deleted-u1@deleted.smileys' }) : null
    expect((await detailPATCH(jsonReq({ status: 'approved' }), params)).status).toBe(400)
    expect(all('user.update')).toHaveLength(0)
  })
})

// ── 6–8. page-level fixes ──────────────────────────────────────────────────
describe('6–8. detail page', () => {
  const src = read('app/admin/users/[id]/page.tsx')

  it('a never-activated member gets the activation resend, and the real error is shown', () => {
    expect(src).toMatch(/user\.hasPassword\s*\n?\s*\? await fetch\('\/app\/api\/auth\/resend-verification'[\s\S]*?: await fetch\(`\/app\/api\/admin\/users\/\$\{id\}\/resend-approval`/)
    expect(src).toContain("else await toastApiError(res, 'Could not send the email')")
    expect(src).not.toContain("toast.error('Failed to send')")
  })

  it('paid totals per currency, not summed list prices; rows priced in the event currency', () => {
    expect(src).not.toContain('totalSpent')
    expect(src).toContain('formatMoney(t.amount, t.currency)')
    expect(src).toContain('formatMoney(je.event.price ?? 0, je.event.currency)')
    expect(read('app/api/admin/users/[id]/route.ts')).toContain('currency: true, price: true, city: { select: { timezone: true } } } } },')
  })

  it('host-quality dates are formatted as calendar days', () => {
    expect(src).not.toContain('new Date(ev.date)')
    expect(src).toContain("formatDay(ev.date, { day: '2-digit', month: 'short' })")
  })

  it('WhatsApp links go through whatsappUrl', () => {
    expect(src).not.toContain("user.phone!.replace(/\\D/g, '')")
    expect(src).toContain('const waBase         = whatsappUrl(user.phone, user.nationality)')
  })

  it('shows a suspension and can lift it; delete failures say why', () => {
    expect(src).toContain('Suspended until')
    expect(src).toContain('Lift suspension')
    expect(src).toMatch(/body: JSON\.stringify\(\{ suspendedUntil: null, suspensionNote: null \}\)/)
    expect(src).toContain("await toastApiError(res, 'Failed to remove')")
    expect(src).not.toContain('window.location.reload()')
  })
})

describe('8. users list', () => {
  const src = read('app/admin/users/page.tsx')

  it('cancelling the bulk-ban reason cancels the ban', () => {
    expect(src).not.toContain("bulkBan(reason ?? 'Banned by admin')")
    expect(src).toMatch(/if \(!reason\?\.trim\(\)\) return\s*\n\s*bulkBan\(reason\.trim\(\)\)/)
  })

  it('selection clears on tab or city change', () => {
    expect(src).toContain('useEffect(() => { setSelected(new Set()) }, [tab, cityFilter])')
  })

  it('only the latest load writes the list', () => {
    expect(src).toContain('const seq = ++loadSeq.current')
    expect(src).toContain('if (seq !== loadSeq.current) return')
  })

  it('a self-deleted account shows no Unban', () => {
    expect(src).toContain("{u.status === 'banned' && !isDeletedAccount(u) && (")
  })
})

// ── 9. moderator-safe member links ─────────────────────────────────────────
describe('9. member links a moderator can open', () => {
  it('memberHref: admins to the admin page, everyone else to the profile', () => {
    expect(memberHref('u1', 'admin')).toBe('/admin/users/u1')
    expect(memberHref('u1', 'moderator')).toBe('/members/u1')
    expect(memberHref('u1', undefined)).toBe('/members/u1')
    expect(isModeratorPageAllowed(memberHref('u1', 'moderator'))).toBe(false)   // not an /admin path at all
    expect(isModeratorPageAllowed('/admin/users/u1')).toBe(false)
  })

  it('Retention links through it', () => {
    for (const p of ['app/admin/retention/page.tsx']) {
      const page = read(p)
      expect(page, p).not.toContain('href={`/admin/users/')
      expect(page, p).toContain('memberHref(')
    }
  })
})
