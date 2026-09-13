import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 72, 73, 80: report screenshots that members can actually
// attach, "resend verification" that sends (and says when it didn't), and
// partner access that follows the account's current role.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => ({
  user:                   { findUnique: vi.fn(), findMany: vi.fn() },
  report:                 { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  event:                  { findUnique: vi.fn() },
  partner:                { findUnique: vi.fn(), update: vi.fn() },
  emailVerificationToken: { deleteMany: vi.fn() },
  passwordResetToken:     { deleteMany: vi.fn(), create: vi.fn() },
  $transaction:           vi.fn(),
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const mail = vi.hoisted(() => ({ sendFinishRegistrationEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(async () => true), getIp: vi.fn(() => '203.0.113.9'),
  claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}),
}))
vi.mock('@/lib/email', () => mail)
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/uploadRoot', () => ({ uploadRoot: () => '/srv/uploads' }))
vi.mock('@/lib/imageMagic', () => ({ detectImageFormat: vi.fn(() => 'jpeg') }))
vi.mock('fs', async (orig) => ({ ...(await orig<typeof import('fs')>()), writeFileSync: vi.fn(), mkdirSync: vi.fn() }))
vi.mock('fs/promises', async (orig) => ({
  ...(await orig<typeof import('fs/promises')>()),
  access: vi.fn(async () => {}), readFile: vi.fn(async () => Buffer.from('jpeg-bytes')),
}))
vi.mock('sharp', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['rotate', 'resize', 'jpeg']) chain[k] = () => chain
  chain.toBuffer = async () => Buffer.from('jpeg-bytes')
  return { default: () => chain }
})

import { POST as uploadPOST } from '@/app/api/upload/route'
import { POST as reportPOST } from '@/app/api/reports/route'
import { GET as fileGET } from '@/app/api/files/[...path]/route'
import { POST as resendPOST } from '@/app/api/auth/resend-verification/route'
import { GET as partnerGET, PATCH as partnerPATCH } from '@/app/api/partner/route'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

const member = { id: 'm1', name: 'Mia', email: 'mia@example.com', role: 'member' }

beforeEach(() => {
  vi.clearAllMocks()
  session.current = null
})

describe('72. report screenshots upload for members and stay staff-only', () => {
  const upload = (folder: string) => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'shot.jpg', { type: 'image/jpeg' }))
    fd.append('folder', folder)
    return uploadPOST({ formData: async () => fd } as never)
  }
  const file = '1700000000000-abcdef123456.jpg'
  const getReportFile = () => fileGET(
    { nextUrl: new URL(`http://x/app/api/files/reports/${file}`) } as never,
    { params: Promise.resolve({ path: ['reports', file] }) },
  )

  it('a regular member can upload into reports/, and the report POST stores that URL', async () => {
    session.current = member
    const res = await upload('reports')
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toMatch(/^\/app\/api\/files\/reports\/\d+-[0-9a-f]{12}\.jpg$/)

    p.user.findUnique.mockResolvedValue({ id: 'r1', name: 'Rex', status: 'approved' })
    p.report.findFirst.mockResolvedValue(null)
    p.report.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rep1', ...data }))
    p.user.findMany.mockResolvedValue([])
    p.report.count.mockResolvedValue(0)
    const rep = await reportPOST({ json: async () => ({ reportedId: 'r1', reason: 'harassment', screenshot: url }) } as never)
    expect(rep.status).toBe(200)
    expect(p.report.create.mock.calls[0][0].data.screenshot).toBe(url)
  })

  it('members are still refused general/ (the folder the button used to post to)', async () => {
    session.current = member
    expect((await upload('general')).status).toBe(403)
  })

  it('reports/ is served to staff only and never cached publicly', async () => {
    expect((await getReportFile()).status).toBe(403)
    session.current = member
    expect((await getReportFile()).status).toBe(403)
    session.current = { ...member, id: 'mod', role: 'moderator' }
    const ok = await getReportFile()
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('evidence is not a member-referenceable image folder', () => {
    expect(isUploadedImageUrl(`/app/api/files/reports/${file}`)).toBe(false)
  })

  it('the button uploads to reports/, previews locally, and a failed upload is a visible choice', () => {
    const src = read('components/ReportButton.tsx')
    expect(src).toContain("fd.append('folder', 'reports')")
    expect(src).not.toContain("fd.append('folder', 'general')")
    expect(src).toMatch(/function failUpload\(message: string\) \{\s*toast\.error\(message\)\s*setUploadError\(message\)/)
    expect(src).toContain('Continue without it')
    expect(src).toMatch(/onClick=\{\(\) => setStep\(4\)\} disabled=\{uploading \|\| !!uploadError\}/)
    expect(src).toContain('<img src={preview}')
    expect(src).not.toContain('<img src={screenshot}')
  })
})

describe('73. resend verification actually sends, and says so honestly', () => {
  const unverified = { id: 'm1', name: 'Mia', email: 'mia@example.com', emailVerified: false, password: 'hash' }
  // The banner sends no body at all; req.json() rejects on that.
  const resend = (body?: unknown) => resendPOST({
    json: body === undefined ? async () => { throw new SyntaxError('Unexpected end of JSON input') } : async () => body,
  } as never)

  beforeEach(() => {
    p.user.findUnique.mockResolvedValue(unverified)
    p.$transaction.mockResolvedValue([])
    mail.sendFinishRegistrationEmail.mockResolvedValue(undefined)
    mail.recordEmailFailure.mockResolvedValue(undefined)
  })

  it("the signed-in banner's empty POST sends to the member's own address", async () => {
    session.current = member
    const res = await resend()
    expect(res.status).toBe(200)
    expect(p.user.findUnique).toHaveBeenCalledWith({ where: { email: 'mia@example.com' } })
    expect(mail.sendFinishRegistrationEmail).toHaveBeenCalledWith('mia@example.com', 'Mia', expect.stringMatching(/^[0-9a-f]{64}$/))
  })

  it('a failed send is a non-2xx for the member, and is recorded', async () => {
    session.current = member
    mail.sendFinishRegistrationEmail.mockRejectedValue({ name: 'invalid_api_key', message: 'API key is invalid' })
    const res = await resend()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/couldn't send/i)
    expect(mail.recordEmailFailure).toHaveBeenCalledWith(expect.objectContaining({ helper: 'sendFinishRegistrationEmail', recipient: 'mia@example.com' }))
  })

  it('staff resending from the admin user page hear about a failure too', async () => {
    session.current = { id: 'adm', name: 'Ada', email: 'ada@example.com', role: 'admin' }
    mail.sendFinishRegistrationEmail.mockRejectedValue(new Error('daily_quota_exceeded'))
    const res = await resend({ email: 'mia@example.com' })
    expect(res.status).toBe(502)
    expect(mail.sendFinishRegistrationEmail).toHaveBeenCalledWith('mia@example.com', 'Mia', expect.any(String))
  })

  it('a stranger gets the same ok either way (no enumeration), but the failure is still recorded', async () => {
    mail.sendFinishRegistrationEmail.mockRejectedValue(new Error('daily_quota_exceeded'))
    const res = await resend({ email: '  Mia@Example.com ' })
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(mail.sendFinishRegistrationEmail).toHaveBeenCalledTimes(1)
    expect(mail.recordEmailFailure).toHaveBeenCalledTimes(1)
  })

  it('no session and no email is a 400, not a 500', async () => {
    expect((await resend()).status).toBe(400)
    expect(mail.sendFinishRegistrationEmail).not.toHaveBeenCalled()
  })

  it("the Resend helper throws on a resolved { error } (emails.send doesn't throw)", () => {
    const src = read('lib/email.ts')
    const fn  = src.slice(src.indexOf('export async function sendFinishRegistrationEmail'), src.indexOf('export async function sendPasswordResetEmail'))
    expect(fn).toMatch(/const \{ error \} = await getResend\(\)\.emails\.send\(/)
    expect(fn).toMatch(/\}\)\s*if \(error\) throw error\s*\}/)
  })

  it('the banner and the login link only say "sent" on a 2xx', () => {
    const banner = read('components/VerifyEmailBanner.tsx')
    expect(banner).toMatch(/if \(res\.ok\) setSent\(true\)\s*else toast\.error\(/)
    const login = read('app/login/page.tsx')
    expect(login).toMatch(/if \(res\.ok\) setResendSent\(true\)\s*else setResendError\(/)
    expect(login).toMatch(/<button type="button" onClick=\{handleResend\}/)
  })
})

describe('80. partner access follows the current role, not the token', () => {
  const jwtPartner = { id: 'u1', name: 'Pat', email: 'pat@example.com', role: 'partner', partnerId: 'p1' }
  const patch = (body: Record<string, unknown>) => partnerPATCH({ json: async () => body } as never)

  beforeEach(() => {
    p.partner.findUnique.mockResolvedValue({ id: 'p1', name: 'Café', logo: null, coverImage: null })
    p.partner.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }))
  })

  it('a partner demoted to member is refused while their JWT still says partner', async () => {
    session.current = jwtPartner
    p.user.findUnique.mockResolvedValue({ role: 'member', partnerId: 'p1' })
    expect((await patch({ discount: '50% off' })).status).toBe(403)
    expect((await partnerGET()).status).toBe(403)
    expect(p.partner.update).not.toHaveBeenCalled()
  })

  it('a member token that still carries a partnerId is refused', async () => {
    session.current = { ...jwtPartner, role: 'member' }
    p.user.findUnique.mockResolvedValue({ role: 'member', partnerId: 'p1' })
    expect((await patch({ discount: '50% off' })).status).toBe(403)
    expect(p.partner.update).not.toHaveBeenCalled()
  })

  it('a current partner can still read and edit their own perk listing', async () => {
    session.current = jwtPartner
    p.user.findUnique.mockResolvedValue({ role: 'partner', partnerId: 'p1' })
    expect((await partnerGET()).status).toBe(200)
    const res = await patch({ discount: '15%' })
    expect(res.status).toBe(200)
    expect(p.partner.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { discount: '15%' } })
  })

  it("edits the partner the account belongs to NOW, not the one in the token", async () => {
    session.current = jwtPartner
    p.user.findUnique.mockResolvedValue({ role: 'partner', partnerId: 'p2' })
    await patch({ discount: '10%' })
    expect(p.partner.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { discount: '10%' } })
  })

  it('a claimed directory business keeps its owner path, which never depended on the partner role', () => {
    const src = read('app/api/directory/[id]/route.ts')
    expect(src).toMatch(/const isOwner = existing\.claimedById === session\.id/)
    expect(src).not.toMatch(/partner/i)
  })
})
