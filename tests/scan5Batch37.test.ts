import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, dirname, basename, sep } from 'node:path'
import ts from 'typescript'

// Fifth scan, batch 37 — production data audit findings:
//  105. application approve/reject/hold audit rows carry the application's city
//       (moderators' city-scoped audit view reads it); a repair script plans
//       the historical rows
//  108. notification links point at pages that exist, in the form the page
//       wants (club broadcasts linked /clubs/<id>; the page is /clubs/<slug>);
//       every call site's link template is checked against app/ routes, and a
//       repair script classifies the links already stored

const h = vi.hoisted(() => ({
  session: { current: { id: 'admin1', name: 'Admin', role: 'admin', cityId: 'c-ist' } as any },
}))

vi.mock('@/lib/session',   () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn(async () => true), recipientSkipReason: vi.fn(() => null) }))
vi.mock('@/lib/stepUp',    () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}), rateLimitRemaining: vi.fn(async () => 5), rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/email',     () => ({
  sendActivationEmail: vi.fn(async () => {}), sendApplicationRejectedEmail: vi.fn(async () => {}),
  sendRequestMoreInfoEmail: vi.fn(async () => {}), sendBroadcastEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}),
}))
vi.mock('@/lib/communitySettings', () => ({ loadCommunitySettings: vi.fn(() => ({ defaultClubId: null })) }))
vi.mock('@/lib/promotePhoto',      () => ({ promoteApplicationPhoto: vi.fn(async () => null) }))
vi.mock('@/lib/neighborhoodsDb',   () => ({ coerceNeighborhoodFor: vi.fn(async () => null) }))
vi.mock('@/lib/cities',            () => ({ getStatsFor: vi.fn(async () => new Map()) }))
vi.mock('@/lib/cityMaturity',      () => ({ CITY_MATURITY: { Seeding: 'seeding' } }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  auditLog:           { create: vi.fn(async () => ({})) },
  memberApplication:  { findUnique: vi.fn(), update: vi.fn() },
  user:               { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'u-new', joinedAt: new Date() })), update: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
  passwordResetToken: { create: vi.fn(async () => ({})) },
  city:               { findUnique: vi.fn(async () => ({ name: 'Izmir' })) },
  club:               { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  clubMembership:     { findMany: vi.fn(async () => []) },
  eventAttendee:      { findMany: vi.fn(async () => []) },
  event:              { findUnique: vi.fn() },
  broadcast:          { create: vi.fn(async () => ({})), findUnique: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn(async () => ({})) },
  notificationPreference: { findMany: vi.fn(async () => []) },
  notification:       { updateMany: vi.fn(async () => ({ count: 0 })) },
} }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendRequestMoreInfoEmail } from '@/lib/email'
import { writeAudit } from '@/lib/audit'
import { PATCH as reviewApplication } from '@/app/api/admin/applications/route'
import { POST as broadcastPOST, PATCH as broadcastPATCH } from '@/app/api/admin/notifications/broadcast/route'
import { planAuditCityRepairs, applicationIdOf } from '@/scripts/repair-application-audit-city'
import {
  PAGE_ROUTES, matchRoute, normalizeLinkFormat, classifyLink, referencedKeys, planLinkRepairs,
  linkRepairWrites, summarizePlan, type ExistenceIndex,
} from '@/scripts/repair-dead-notification-links'

const p = prisma as any
const req = (body: unknown) => ({ json: async () => body }) as any
const flush = () => new Promise(r => setTimeout(r, 0))
const auditRows = (action: string) => p.auditLog.create.mock.calls.map((c: any[]) => c[0].data).filter((d: any) => d.action === action)

beforeEach(() => {
  vi.clearAllMocks()
  h.session.current = { id: 'admin1', name: 'Admin', role: 'admin', cityId: 'c-ist' }
})

// ── 105 — application audit rows carry the city ─────────────────────────────

describe('105 — application decisions audit with the application city', () => {
  const APP = { id: 'a1', fullName: 'Ayşe Yılmaz', email: 'ayse@x.com', targetCityId: 'c-izm', assignedClubs: [], interests: [], socialStyles: [], lookingFor: [] }
  const applicationIn = (id: string, cityId: string) => {
    p.memberApplication.findUnique.mockResolvedValueOnce({ status: 'pending', targetCityId: cityId, targetCity: { slug: cityId.slice(2) } })
    p.memberApplication.update.mockImplementationOnce(async ({ data }: any) => ({ ...APP, id, targetCityId: cityId, status: data.status }))
  }

  it('approve writes the city', async () => {
    applicationIn('a1', 'c-izm')
    const res = await reviewApplication(req({ id: 'a1', status: 'approved' }))
    await flush()
    expect(res.status).toBe(200)
    expect(auditRows('application.approve')).toEqual([expect.objectContaining({ targetId: 'a1', targetType: 'memberApplication', cityId: 'c-izm' })])
  })

  it('reject writes the city', async () => {
    applicationIn('a1', 'c-ant')
    await reviewApplication(req({ id: 'a1', status: 'rejected', reviewNote: 'no' }))
    await flush()
    expect(auditRows('application.reject')).toEqual([expect.objectContaining({ targetId: 'a1', cityId: 'c-ant' })])
  })

  it('hold (the waitlist) now audits, with the city, whether or not more info was asked', async () => {
    applicationIn('a1', 'c-bur')
    await reviewApplication(req({ id: 'a1', status: 'hold', moreInfoMessage: 'Which neighborhood?' }))
    applicationIn('a2', 'c-bur')
    await reviewApplication(req({ id: 'a2', status: 'hold' }))
    await flush()
    expect(sendRequestMoreInfoEmail).toHaveBeenCalledTimes(1)
    const rows = auditRows('application.hold')
    expect(rows.map((r: any) => [r.targetId, r.cityId, r.meta.moreInfoRequested])).toEqual([['a1', 'c-bur', true], ['a2', 'c-bur', false]])
  })

  it('a bulk decision across cities gives each row its own city', async () => {
    applicationIn('a1', 'c-izm')
    applicationIn('a2', 'c-ant')
    await reviewApplication(req({ id: 'a1', status: 'rejected', reviewNote: 'Bulk-rejected from queue' }))
    await reviewApplication(req({ id: 'a2', status: 'rejected', reviewNote: 'Bulk-rejected from queue' }))
    await flush()
    expect(auditRows('application.reject').map((r: any) => [r.targetId, r.cityId])).toEqual([['a1', 'c-izm'], ['a2', 'c-ant']])
  })

  it('writeAudit resolves a memberApplication target without being told the city', async () => {
    p.memberApplication.findUnique.mockResolvedValueOnce({ targetCityId: 'c-tbs' })
    await writeAudit('a', 'Admin', 'application.approve', 'a9', 'memberApplication')
    expect(p.memberApplication.findUnique).toHaveBeenCalledWith({ where: { id: 'a9' }, select: { targetCityId: true } })
    expect(auditRows('application.approve')[0].cityId).toBe('c-tbs')
    p.memberApplication.findUnique.mockResolvedValueOnce(null)
    await writeAudit('a', 'Admin', 'application.reject', 'gone', 'memberApplication')
    expect(auditRows('application.reject')[0].cityId).toBeNull()
  })
})

describe('105 — repair-application-audit-city planner', () => {
  const at = new Date('2026-08-01T00:00:00Z')
  const row = (over: any) => ({ id: 'l1', action: 'application.approve', targetId: 'a1', targetType: 'memberApplication', meta: null, createdAt: at, ...over })

  it('proposes the application city; lists the rest as UNRESOLVABLE with a reason', () => {
    const plan = planAuditCityRepairs([
      row({}),
      row({ id: 'l2', targetId: 'gone' }),
      row({ id: 'l3', targetId: null, meta: { name: 'X' } }),
      row({ id: 'l4', targetId: null, targetType: null, meta: { applicationId: 'a2' }, action: 'application.reject' }),
      row({ id: 'l5', targetId: 'a3' }),
      row({ id: 'l6', action: 'user.suspend', targetType: 'user', targetId: 'u1' }),
    ], [{ id: 'a1', targetCityId: 'c-izm' }, { id: 'a2', targetCityId: 'c-ant' }, { id: 'a3', targetCityId: '' }])
    expect(plan.map(p => [p.auditId, p.status, p.status === 'RESOLVABLE' ? p.cityId : p.reason])).toEqual([
      ['l1', 'RESOLVABLE', 'c-izm'],
      ['l2', 'UNRESOLVABLE', 'application_gone'],
      ['l3', 'UNRESOLVABLE', 'no_application_id'],
      ['l4', 'RESOLVABLE', 'c-ant'],
      ['l5', 'UNRESOLVABLE', 'application_has_no_city'],
    ])
  })

  it('reads the application id from targetId first, then meta', () => {
    expect(applicationIdOf({ targetId: 't', meta: { applicationId: 'm' } })).toBe('t')
    expect(applicationIdOf({ targetId: null, meta: { id: 'm' } })).toBe('m')
    expect(applicationIdOf({ targetId: null, meta: 'junk' })).toBeNull()
  })
})

// ── 108 — broadcast links use the club slug ─────────────────────────────────

describe('108 — club broadcasts link to /clubs/<slug>', () => {
  const send = (body: any) => broadcastPOST(req({ title: 'T', message: 'M', type: 'announcement', channel: 'in-app', requestId: 'req-0001-abcd', ...body }))

  it('a club send links the slug, not the id', async () => {
    p.clubMembership.findMany.mockResolvedValueOnce([{ user: { id: 'u1', name: 'A', email: 'a@x', emailMarketing: false, emailVerified: true, status: 'approved', suspendedUntil: null, cityId: 'c-tbs' } }])
    p.club.findUnique.mockResolvedValueOnce({ slug: 'book-club' })
    const res = await send({ audience: 'club', clubId: 'k1' })
    expect(res.status).toBe(202)
    // The fan-out runs after the 202 is answered.
    await vi.waitFor(() => expect(createNotification).toHaveBeenCalled())
    // The trailing arguments are the recipient row — read once for the
    // audience and handed over so createNotification skips a lookup per
    // member — the member's preferences, and the broadcast's optional
    // image, null on a send that carried none.
    // …including the member's own city, so quiet hours are read in THEIR
    // timezone — a row without it was Istanbul time for a member in Tbilisi.
    expect((createNotification as any).mock.calls[0]).toEqual(['u1', 'announcement', 'T', 'M', '/clubs/book-club', { status: 'approved', suspendedUntil: null, cityId: 'c-tbs' }, null, { imageUrl: null }])
  })

  it('a club that vanished gets no link rather than a 404; an event send keeps /events/<id>', async () => {
    p.clubMembership.findMany.mockResolvedValueOnce([{ user: { id: 'u1', name: 'A', email: 'a@x', emailMarketing: false } }])
    p.club.findUnique.mockResolvedValueOnce(null)
    await send({ audience: 'club', clubId: 'k1' })
    await vi.waitFor(() => expect(createNotification).toHaveBeenCalled())
    expect((createNotification as any).mock.calls[0][4]).toBeUndefined()
    p.eventAttendee.findMany.mockResolvedValueOnce([{ user: { id: 'u2', name: 'B', email: 'b@x', emailMarketing: false } }])
    await send({ audience: 'event', eventId: 'e1', requestId: 'req-0002-abcd' })
    expect((createNotification as any).mock.calls[1][4]).toBe('/events/e1')
  })

  it('editing still finds the rows of a deleted club by their old id link', async () => {
    const sentAt = new Date('2026-09-10T10:00:00Z')
    p.broadcast.findUnique.mockResolvedValueOnce({ id: 'b1', type: 'announcement', title: 'T', message: 'M', clubId: 'k1', eventId: null, createdAt: sentAt })
    p.club.findUnique.mockResolvedValueOnce(null)
    await broadcastPATCH(req({ id: 'b1', title: 'T2', message: 'M2' }))
    expect(p.notification.updateMany.mock.calls[0][0].where.link).toEqual({ in: ['/clubs/k1'] })
    p.broadcast.findUnique.mockResolvedValueOnce({ id: 'b2', type: 'announcement', title: 'T', message: 'M', clubId: null, eventId: 'e1', createdAt: sentAt })
    await broadcastPATCH(req({ id: 'b2', title: 'T2', message: 'M2' }))
    expect(p.notification.updateMany.mock.calls[1][0].where.link).toBe('/events/e1')
  })
})

// ── 108 — every call site's link template maps to a page ────────────────────

const ROOT = join(__dirname, '..')
const APP  = join(ROOT, 'app')

function pageRoutesOnDisk(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { if (!(dir === APP && e.name === 'api')) walk(full) }
      else if (e.name === 'page.tsx') out.push(full)
    }
  }
  walk(APP)
  return out
    .map(f => '/' + relative(APP, dirname(f)).split(sep).filter(s => s && !/^\(.*\)$/.test(s)).join('/'))
    .sort()
}

const HOLE = "\u0000"
type Tpl = { text: string; subs: string[] }

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'archive') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(e.name)) out.push(full)
    }
  }
  for (const d of ['app', 'lib', 'scripts']) walk(join(ROOT, d))
  return out
}

class LinkScanner {
  private text = new Map<string, string>()
  private parsed = new Map<string, ts.SourceFile>()
  unresolved: string[] = []
  templates: (Tpl & { site: string })[] = []

  constructor(private files: string[]) {
    for (const f of files) this.text.set(f, readFileSync(f, 'utf8'))
  }
  private sf(f: string) {
    let s = this.parsed.get(f)
    if (!s) { s = ts.createSourceFile(f, this.text.get(f)!, ts.ScriptTarget.Latest, true); this.parsed.set(f, s) }
    return s
  }
  private site(n: ts.Node) {
    const s = n.getSourceFile()
    return `${relative(ROOT, s.fileName)}:${s.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
  }

  scan() {
    for (const f of this.files) {
      const src = this.text.get(f)!
      if (!/createNotification\(|notification\.createMany\(|notification\.create\(/.test(src)) continue
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression.getText()
          if (callee === 'createNotification') this.collect(n.arguments[4], n)
          // createNotification's own insert only re-reports every caller's link.
          else if (/(^|\.)notification\.create(Many)?$/.test(callee) && !this.insideCreateNotification(n)) {
            const walkProps = (x: ts.Node) => {
              if ((ts.isPropertyAssignment(x) || ts.isShorthandPropertyAssignment(x)) && x.name.getText() === 'link') {
                this.collect(ts.isPropertyAssignment(x) ? x.initializer : x.name, n)
              }
              ts.forEachChild(x, walkProps)
            }
            n.arguments.forEach(walkProps)
          }
        }
        ts.forEachChild(n, visit)
      }
      visit(this.sf(f))
    }
  }

  private insideCreateNotification(n: ts.Node) {
    for (let x: ts.Node | undefined = n; x; x = x.parent) {
      if (ts.isFunctionDeclaration(x) && x.name?.text === 'createNotification') return true
    }
    return false
  }

  private collect(arg: ts.Expression | undefined, call: ts.Node) {
    if (!arg) return
    const r = this.resolve(arg, 0)
    if (r === null) { this.unresolved.push(`${this.site(call)}  ${arg.getText()}`); return }
    for (const t of r) this.templates.push({ ...t, site: this.site(call) })
  }

  private resolve(e: ts.Expression, depth: number): Tpl[] | null {
    if (depth > 10) return null
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) e = e.expression
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [{ text: e.text, subs: [] }]
    if (ts.isTemplateExpression(e)) {
      let text = e.head.text
      const subs: string[] = []
      for (const s of e.templateSpans) { text += HOLE + s.literal.text; subs.push(s.expression.getText()) }
      return [{ text, subs }]
    }
    if (ts.isConditionalExpression(e)) {
      const a = this.resolve(e.whenTrue, depth + 1), b = this.resolve(e.whenFalse, depth + 1)
      return a && b ? [...a, ...b] : null
    }
    if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return []
    if (ts.isIdentifier(e)) return this.resolveName(e.text, e, depth)
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const hit = this.lookup(e.expression.text, e)
      if (hit?.kind === 'param') return this.resolveCallers(hit.fn, hit.index, e.name.text, depth)
      return null
    }
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
      const hit = this.lookup(e.expression.text, e)
      if (hit?.kind === 'fn') return this.resolveReturns(hit.fn, null, depth)
      return null
    }
    return null
  }

  private resolveName(name: string, at: ts.Node, depth: number): Tpl[] | null {
    const hit = this.lookup(name, at)
    if (!hit) return null
    if (hit.kind === 'var')   return hit.init ? this.resolve(hit.init, depth + 1) : null
    if (hit.kind === 'param') return this.resolveCallers(hit.fn, hit.index, null, depth)
    if (hit.kind === 'bind') {
      let init: ts.Expression | undefined = hit.init
      while (init && (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression
      if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) return null
      const fn = this.lookup(init.expression.text, init)
      return fn?.kind === 'fn' ? this.resolveReturns(fn.fn, hit.prop, depth) : null
    }
    return null
  }

  // Innermost declaration of `name` visible from `at`: block-scoped consts,
  // destructured bindings, function declarations, then enclosing parameters.
  private lookup(name: string, at: ts.Node):
    | { kind: 'var'; init?: ts.Expression }
    | { kind: 'bind'; init?: ts.Expression; prop: string }
    | { kind: 'fn'; fn: ts.SignatureDeclaration }
    | { kind: 'param'; fn: ts.SignatureDeclaration; index: number }
    | null {
    for (let n: ts.Node | undefined = at; n; n = n.parent) {
      if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isCaseClause(n)) {
        for (const st of n.statements) {
          if (ts.isFunctionDeclaration(st) && st.name?.text === name) return { kind: 'fn', fn: st }
          if (!ts.isVariableStatement(st)) continue
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name) {
              if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return { kind: 'fn', fn: d.initializer }
              return { kind: 'var', init: d.initializer }
            }
            if (ts.isObjectBindingPattern(d.name)) {
              for (const el of d.name.elements) {
                if (ts.isIdentifier(el.name) && el.name.text === name) {
                  return { kind: 'bind', init: d.initializer, prop: el.propertyName?.getText() ?? name }
                }
              }
            }
          }
        }
      }
      if (ts.isFunctionLike(n)) {
        const i = n.parameters.findIndex(pr => ts.isIdentifier(pr.name) && pr.name.text === name)
        if (i !== -1) return { kind: 'param', fn: n, index: i }
      }
    }
    return null
  }

  private fnName(fn: ts.SignatureDeclaration): string | null {
    if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text
    if (fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text
    return null
  }

  private resolveCallers(fn: ts.SignatureDeclaration, index: number, prop: string | null, depth: number): Tpl[] | null {
    const name = this.fnName(fn)
    if (!name) return null
    const home = fn.getSourceFile().fileName
    const homeBase = basename(home).replace(/\.tsx?$/, '')
    const out: Tpl[] = []
    let calls = 0
    for (const f of this.files) {
      const src = this.text.get(f)!
      if (!src.includes(`${name}(`)) continue
      const s = this.sf(f)
      if (f !== home) {
        const imported = s.statements.some(st => ts.isImportDeclaration(st)
          && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.split('/').pop() === homeBase
          && !!st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)
          && st.importClause.namedBindings.elements.some(el => el.name.text === name))
        if (!imported) continue
      }
      let failed = false
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
          calls++
          const arg = n.arguments[index]
          let r: Tpl[] | null = []
          if (prop === null) r = arg ? this.resolve(arg, depth + 1) : []
          else if (arg && ts.isObjectLiteralExpression(arg)) {
            const pa = arg.properties.find(x => x.name?.getText() === prop)
            r = !pa ? [] : ts.isPropertyAssignment(pa) ? this.resolve(pa.initializer, depth + 1)
              : ts.isShorthandPropertyAssignment(pa) ? this.resolveName(prop, pa, depth + 1) : null
          } else r = null
          if (r === null) failed = true
          else out.push(...r)
        }
        ts.forEachChild(n, visit)
      }
      visit(s)
      if (failed) return null
    }
    return calls ? out : null
  }

  private resolveReturns(fn: ts.SignatureDeclaration, prop: string | null, depth: number): Tpl[] | null {
    const body = (fn as ts.FunctionLikeDeclaration).body
    if (!body) return null
    const exprs: ts.Expression[] = []
    if (!ts.isBlock(body)) exprs.push(body)
    else {
      const visit = (n: ts.Node) => {
        if (ts.isFunctionLike(n)) return
        if (ts.isReturnStatement(n) && n.expression) exprs.push(n.expression)
        ts.forEachChild(n, visit)
      }
      body.statements.forEach(visit)
    }
    const out: Tpl[] = []
    for (let e of exprs) {
      while (ts.isParenthesizedExpression(e)) e = e.expression
      if (prop === null) { const r = this.resolve(e, depth + 1); if (!r) return null; out.push(...r); continue }
      if (!ts.isObjectLiteralExpression(e)) return null
      const pa = e.properties.find(x => x.name?.getText() === prop)
      if (!pa) continue
      const r = ts.isPropertyAssignment(pa) ? this.resolve(pa.initializer, depth + 1)
        : ts.isShorthandPropertyAssignment(pa) ? this.resolveName(prop, pa, depth + 1) : null
      if (!r) return null
      out.push(...r)
    }
    return out
  }
}

/** Why a template can't open a page, or null when it maps to one. */
function templateProblem(t: Tpl, routes: string[]): string | null {
  if (!t.text.startsWith('/')) return 'not an absolute app path'
  if (/^\/app(?=[/?#]|$)/.test(t.text)) return 'starts with the /app basePath — the router adds it again'
  if (t.text.startsWith('/api/')) return 'an API route, not a page'
  const pathEnd = t.text.search(/[?#]/)
  const path = pathEnd === -1 ? t.text : t.text.slice(0, pathEnd)
  const parts = path.split('/').filter(Boolean)
  let holeBase = 0
  const partHoles = parts.map(seg => { const start = holeBase; holeBase += seg.split(HOLE).length - 1; return start })
  let best: { route: string; rank: string } | null = null
  for (const route of routes) {
    const rs = route.split('/').filter(Boolean)
    if (rs.length !== parts.length) continue
    let rank = ''
    const ok = rs.every((r, i) => {
      const dyn = /^\[.+\]$/.test(r)
      const seg = parts[i]
      if (!dyn) { rank += '0'; return r === seg }
      rank += '1'
      // A bare word is never a city: '/listings' must not pass as /[city].
      if (r === '[city]' && !seg.includes(HOLE)) return false
      if (seg === HOLE) {
        const sub = t.subs[partHoles[i]] ?? ''
        // Slug pages need a slug; id pages must not be handed one.
        if (/slug/i.test(r) || r === '[city]') return /slug/i.test(sub)
        return !/slug/i.test(sub)
      }
      return true
    })
    if (ok && (!best || rank < best.rank)) best = { route, rank }
  }
  return best ? null : `no page matches ${path.replace(new RegExp(HOLE, 'g'), '${…}')}`
}

describe('108 — notification link templates at call sites', () => {
  const routes = pageRoutesOnDisk()
  const scanner = new LinkScanner(sourceFiles())
  scanner.scan()

  it('the repair script route list is the app/ page list', () => {
    expect([...PAGE_ROUTES].sort()).toEqual(routes)
  })

  it('every call site link resolves to literal templates', () => {
    expect(scanner.unresolved).toEqual([])
    expect(scanner.templates.length).toBeGreaterThan(90)
    // Wrappers and helpers are followed: the club wall's createMany, mentions, the broadcast helper.
    const texts = scanner.templates.map(t => t.text)
    expect(texts).toContain(`/neighborhoods/${HOLE}`)
    expect(texts).toContain(`/reviews?event=${HOLE}`)
    expect(scanner.templates.filter(t => t.site.startsWith('app/api/admin/notifications/broadcast')).map(t => [t.text, t.subs])).toEqual([
      [`/events/${HOLE}`, ['eventId']], [`/clubs/${HOLE}`, ['club.slug']],
    ])
  })

  it('every template maps to an existing page, without the basePath, id/slug in the right place', () => {
    const problems = scanner.templates
      .map(t => ({ t, why: templateProblem(t, routes) }))
      .filter(x => x.why)
      .map(x => `${x.t.site}  ${x.t.text.replace(new RegExp(HOLE, 'g'), '${…}')}  — ${x.why}`)
    expect(problems).toEqual([])
  })

  it('the checker itself rejects the formats that shipped dead', () => {
    const routesList = routes
    expect(templateProblem({ text: `/app/events/${HOLE}`, subs: ['eventId'] }, routesList)).toMatch(/basePath/)
    expect(templateProblem({ text: `/clubs/${HOLE}`, subs: ['clubId'] }, routesList)).toMatch(/no page/)
    expect(templateProblem({ text: '/listings', subs: [] }, routesList)).toMatch(/no page/)
    expect(templateProblem({ text: `/${HOLE}`, subs: ['dest.slug'] }, routesList)).toBeNull()
    expect(templateProblem({ text: `/board?post=${HOLE}`, subs: ['id'] }, routesList)).toBeNull()
  })
})

// ── 108 — repair-dead-notification-links planner ────────────────────────────

describe('108 — repair-dead-notification-links planner', () => {
  const index: ExistenceIndex = {
    keys: {
      'event':             new Set(['e1']),
      'listing':           new Set(['l1']),
      'club.slug':         new Set(['book-club']),
      'club.id':           new Set(['k1']),
      'city.slug':         new Set(['izmir']),
      'boardPost':         new Set(['bp1']),
      'user':              new Set(['u1']),
      'neighborhood.slug': new Set(['moda']),
    },
    clubSlugById: new Map([['k1', 'book-club']]),
  }
  const c = (link: string) => classifyLink(link, index)

  it('matches routes with literal segments first', () => {
    expect(matchRoute('/clubs/feed')?.route).toBe('/clubs/feed')
    expect(matchRoute('/clubs/book-club')).toEqual({ route: '/clubs/[slug]', params: { slug: 'book-club' } })
    expect(matchRoute('/events')?.route).toBe('/events')
    expect(matchRoute('/izmir/events')?.route).toBe('/[city]/events')
    expect(matchRoute('/hangouts/recap')?.route).toBe('/hangouts/recap')
    expect(matchRoute('/')?.route).toBe('/')
    expect(matchRoute('/nope/nope/nope')).toBeNull()
  })

  it('normalises format-only mistakes', () => {
    expect(normalizeLinkFormat('/app/events/e1?x=1').link).toBe('/events/e1?x=1')
    expect(normalizeLinkFormat('/app').link).toBe('/')
    expect(normalizeLinkFormat('/listings/l1').link).toBe('/board/l1')
    expect(normalizeLinkFormat('/approve').link).toBe('/approve')
    expect(normalizeLinkFormat('events/e1').link).toBe('/events/e1')
  })

  it('LIVE when the page and its row exist', () => {
    for (const l of ['/events/e1', '/events/e1?from=home', '/clubs/book-club', '/izmir', '/board?post=bp1', '/survey/nps?period=2026-09', '/no-show', '/messages/u1', '/neighborhoods/moda', '/']) {
      expect([l, c(l).status]).toEqual([l, 'LIVE'])
    }
  })

  it('REWRITABLE for the known wrong formats, to a link that is itself live', () => {
    expect(c('/app/events/e1')).toMatchObject({ status: 'REWRITABLE', newLink: '/events/e1' })
    expect(c('/clubs/k1')).toMatchObject({ status: 'REWRITABLE', newLink: '/clubs/book-club' })
    expect(c('/app/clubs/k1')).toMatchObject({ status: 'REWRITABLE', newLink: '/clubs/book-club' })
    expect(c('/listings/l1')).toMatchObject({ status: 'REWRITABLE', newLink: '/board/l1' })
    expect(c('/app/guide/routes/bosphorus')).toMatchObject({ status: 'REWRITABLE', newLink: '/guide/routes/bosphorus' })
    for (const l of ['/app/events/e1', '/clubs/k1', '/listings/l1']) expect(c(c(l).newLink!).status).toBe('LIVE')
  })

  it('DEAD (→ null) when the page does not exist or the row is gone', () => {
    expect(c('/app/events/gone')).toMatchObject({ status: 'DEAD', newLink: null })
    expect(c('/clubs/gone')).toMatchObject({ status: 'DEAD', newLink: null })
    expect(c('/board?post=gone')).toMatchObject({ status: 'DEAD', newLink: null })
    expect(c('/atlantis')).toMatchObject({ status: 'DEAD', reason: 'city atlantis no longer exists' })
    expect(c('/listings/gone')).toMatchObject({ status: 'DEAD' })
    expect(c('/some/missing/page')).toMatchObject({ status: 'DEAD', reason: 'no such page' })
    expect(c('/members/deleted-user')).toMatchObject({ status: 'DEAD' })
  })

  it('UNVERIFIED — never written — for absolute URLs and unchecked params', () => {
    expect(c('https://example.com/x').status).toBe('UNVERIFIED')
    expect(c('/guide/routes/bosphorus').status).toBe('UNVERIFIED')
    expect(c('/handbook/category/visas').status).toBe('UNVERIFIED')
  })

  it('asks for every id and slug it needs, club slugs also as ids', () => {
    const keys = referencedKeys(['/app/events/e9', '/clubs/k7', '/board?post=bp9', '/izmir/board', 'https://x.test'])
    expect([...keys.get('event')!]).toEqual(['e9'])
    expect([...keys.get('club.slug')!]).toEqual(['k7'])
    expect([...keys.get('club.id')!]).toEqual(['k7'])
    expect([...keys.get('boardPost')!]).toEqual(['bp9'])
    expect([...keys.get('city.slug')!]).toEqual(['izmir'])
  })

  it('writes only REWRITABLE and DEAD rows, guarded on the old link; groups by pattern', () => {
    const plan = planLinkRepairs([
      { id: 'n1', link: '/events/e1' },
      { id: 'n2', link: '/app/events/e1' },
      { id: 'n3', link: '/app/events/gone' },
      { id: 'n4', link: '/guide/routes/x' },
      { id: 'n5', link: '/events/e1' },
    ], index)
    expect(linkRepairWrites(plan)).toEqual([
      { id: 'n2', oldLink: '/app/events/e1', newLink: '/events/e1' },
      { id: 'n3', oldLink: '/app/events/gone', newLink: null },
    ])
    expect(summarizePlan(plan).map(g => [g.status, g.pattern, g.count])).toEqual([
      ['DEAD',       '/events/[id]  (/app prefix)', 1],
      ['REWRITABLE', '/events/[id]  (/app prefix)', 1],
      ['UNVERIFIED', '/guide/routes/[slug]', 1],
      ['LIVE',       '/events/[id]', 2],
    ])
  })
})
