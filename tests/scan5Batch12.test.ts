import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'

// Scan 5, items 41 and 48.
const read = (p: string) => fs.readFileSync(p, 'utf8')

// The fs spies wrap the real functions, so the handlers really write into a
// temp dir — the spies only let a test fail a write or read the call order.
vi.mock('fs', async (importOriginal) => {
  const a = await importOriginal<typeof import('fs')>()
  const m = {
    ...a,
    writeFileSync: vi.fn(a.writeFileSync),
    renameSync:    vi.fn(a.renameSync),
    unlinkSync:    vi.fn(a.unlinkSync),
    readdirSync:   vi.fn(a.readdirSync),
  }
  return { ...m, default: m }
})

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/neighborhoods', () => ({ slugToNeighborhood: vi.fn(() => 'Moda') }))
vi.mock('@/lib/neighborhoodsDb', () => ({ getNeighborhoodView: vi.fn(async () => ({ name: 'Alsancak' })) }))
vi.mock('@/lib/prisma', () => ({
  prisma: { city: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
    ({ id: `c-${where.slug}`, slug: where.slug, name: where.slug })) } },
}))
// Guide JSON goes to the temp dir too, never the repo's data/neighborhoods.
vi.mock('@/lib/neighborhoodGuideFiles', async (importOriginal) => {
  const a = await importOriginal<typeof import('@/lib/neighborhoodGuideFiles')>()
  return {
    ...a,
    guideFileFor: (citySlug: string, isDefault: boolean, slug: string) =>
      isDefault ? join(state.root, 'data', `${slug}.json`) : join(state.root, 'data', citySlug, `${slug}.json`),
  }
})

import { POST as upload } from '@/app/api/admin/neighborhoods/[slug]/image/route'
import { PUT as saveGuide } from '@/app/api/admin/neighborhoods/[slug]/route'
import { getSession } from '@/lib/session'

const fsm = fs as unknown as Record<'writeFileSync' | 'renameSync' | 'unlinkSync', ReturnType<typeof vi.fn>>
const bannerDir = () => join(state.root, 'uploads', 'neighborhoods')
const put = (name: string) => fs.writeFileSync(join(bannerDir(), name), 'x')
const has = (name: string) => fs.existsSync(join(bannerDir(), name))
const url = (name: string) => `/app/api/files/neighborhoods/${name}`
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })
const putReq = (slug: string, city: string | null, body: object) => ({
  nextUrl: new URL(`http://x/app/api/admin/neighborhoods/${slug}${city ? `?city=${city}` : ''}`),
  json: async () => body,
}) as any

beforeEach(() => {
  state.root = fs.mkdtempSync(join(tmpdir(), 'scan5b12-'))
  fs.mkdirSync(bannerDir(), { recursive: true })
  process.env.UPLOAD_DIR = join(state.root, 'uploads')
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
})
afterEach(() => {
  delete process.env.UPLOAD_DIR
  fs.rmSync(state.root, { recursive: true, force: true })
})

describe('41. a banner upload never deletes the live banner; Save prunes after it writes', () => {
  it('uploading a replacement leaves the saved banner on disk', async () => {
    put('izmir--alsancak-1000.jpg')
    const jpg = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#f80' } }).jpeg().toBuffer()
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(jpg)], 'b.jpg', { type: 'image/jpeg' }))
    const req = { nextUrl: new URL('http://x/app/api/admin/neighborhoods/alsancak/image?city=izmir'), formData: async () => fd } as any

    const res = await upload(req, ctx('alsancak'))
    expect(res.status).toBe(200)
    const { url: newUrl } = await res.json()
    expect(newUrl).toMatch(/^\/app\/api\/files\/neighborhoods\/izmir--alsancak-\d+\.jpg$/)
    expect(has(newUrl.split('/').pop())).toBe(true)
    expect(has('izmir--alsancak-1000.jpg')).toBe(true)
    expect(fsm.unlinkSync).not.toHaveBeenCalled()
  })

  it('the upload route has no delete path at all', () => {
    const src = read('app/api/admin/neighborhoods/[slug]/image/route.ts')
    expect(src).not.toMatch(/unlinkSync|readdirSync|rmSync/)
  })

  it('saving the new banner deletes the superseded and abandoned files, only after the write', async () => {
    ;['izmir--alsancak-1000.jpg', 'izmir--alsancak-1500.jpg', 'izmir--alsancak-2000.jpg',
      'izmir--alsancak-old-3000.jpg', 'izmir--karsiyaka-1000.jpg', 'alsancak-1000.jpg'].forEach(put)

    const res = await saveGuide(putReq('alsancak', 'izmir', { tagline: 't', image: url('izmir--alsancak-2000.jpg') }), ctx('alsancak'))
    expect(res.status).toBe(200)

    expect(has('izmir--alsancak-2000.jpg')).toBe(true)   // the saved banner
    expect(has('izmir--alsancak-1000.jpg')).toBe(false)  // the previously live one
    expect(has('izmir--alsancak-1500.jpg')).toBe(false)  // an upload never saved
    expect(has('izmir--alsancak-old-3000.jpg')).toBe(true) // another slug sharing the prefix
    expect(has('izmir--karsiyaka-1000.jpg')).toBe(true)
    expect(has('alsancak-1000.jpg')).toBe(true)          // the default city's same slug

    const renamedAt = Math.max(...fsm.renameSync.mock.invocationCallOrder)
    expect(fsm.unlinkSync).toHaveBeenCalledTimes(2)
    for (const at of fsm.unlinkSync.mock.invocationCallOrder) expect(at).toBeGreaterThan(renamedAt)
  })

  it('a save that keeps the current banner removes only the unsaved uploads', async () => {
    ;['izmir--alsancak-1000.jpg', 'izmir--alsancak-2000.jpg'].forEach(put)
    const res = await saveGuide(putReq('alsancak', 'izmir', { image: url('izmir--alsancak-1000.jpg') }), ctx('alsancak'))
    expect(res.status).toBe(200)
    expect(has('izmir--alsancak-1000.jpg')).toBe(true)
    expect(has('izmir--alsancak-2000.jpg')).toBe(false)
  })

  it('a failed write deletes nothing', async () => {
    ;['izmir--alsancak-1000.jpg', 'izmir--alsancak-2000.jpg'].forEach(put)
    fsm.writeFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC') })
    await expect(saveGuide(putReq('alsancak', 'izmir', { image: url('izmir--alsancak-2000.jpg') }), ctx('alsancak'))).rejects.toThrow('ENOSPC')
    expect(fsm.unlinkSync).not.toHaveBeenCalled()
    expect(has('izmir--alsancak-1000.jpg')).toBe(true)
    expect(has('izmir--alsancak-2000.jpg')).toBe(true)
  })

  it('a failed rename deletes nothing', async () => {
    ;['izmir--alsancak-1000.jpg', 'izmir--alsancak-2000.jpg'].forEach(put)
    fsm.renameSync.mockImplementationOnce(() => { throw new Error('EXDEV') })
    await expect(saveGuide(putReq('alsancak', 'izmir', { image: url('izmir--alsancak-2000.jpg') }), ctx('alsancak'))).rejects.toThrow('EXDEV')
    expect(fsm.unlinkSync).not.toHaveBeenCalled()
    expect(has('izmir--alsancak-1000.jpg')).toBe(true)
  })

  it('a rejected body (bad banner URL) deletes nothing', async () => {
    put('izmir--alsancak-1000.jpg')
    const res = await saveGuide(putReq('alsancak', 'izmir', { image: 'https://evil.example/x.jpg' }), ctx('alsancak'))
    expect(res.status).toBe(400)
    expect(fsm.unlinkSync).not.toHaveBeenCalled()
  })

  it('default city: prunes timestamped and legacy bare files, never a longer slug or another city', async () => {
    ;['moda.jpg', 'moda-1000.jpg', 'moda-2000.jpg', 'moda-burnu-1000.jpg', 'izmir--moda-1000.jpg'].forEach(put)
    const res = await saveGuide(putReq('moda', null, { image: url('moda-2000.jpg') }), ctx('moda'))
    expect(res.status).toBe(200)
    expect(has('moda-2000.jpg')).toBe(true)
    expect(has('moda.jpg')).toBe(false)
    expect(has('moda-1000.jpg')).toBe(false)
    expect(has('moda-burnu-1000.jpg')).toBe(true)
    expect(has('izmir--moda-1000.jpg')).toBe(true)
  })

  it('a delete that fails is ignored — the save still succeeds', async () => {
    ;['izmir--alsancak-1000.jpg', 'izmir--alsancak-1500.jpg', 'izmir--alsancak-2000.jpg'].forEach(put)
    fsm.unlinkSync.mockImplementationOnce(() => { throw new Error('EBUSY') })
    const res = await saveGuide(putReq('alsancak', 'izmir', { image: url('izmir--alsancak-2000.jpg') }), ctx('alsancak'))
    expect(res.status).toBe(200)
    expect(has('izmir--alsancak-2000.jpg')).toBe(true)
    expect(fsm.unlinkSync).toHaveBeenCalledTimes(2)
  })

  it('the editor tells the admin an upload is not live until Save', () => {
    expect(read('app/admin/neighborhoods/[slug]/page.tsx')).toContain("toast.success('Banner uploaded — Save to publish it')")
  })
})

describe('48. bulk approve / promote confirm first and report once (already fixed, pinned)', () => {
  const between = (src: string, start: string, end: string) => {
    const i = src.indexOf(start)
    const j = src.indexOf(end, i + start.length)
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    return src.slice(i, j)
  }

  it('/admin/participants bulkRun: confirm, then a sequential loop, then the summary', () => {
    const src = read('app/admin/participants/page.tsx')
    const body = between(src, 'async function bulkRun(', 'const patchAction')
    const confirmAt = body.indexOf('if (!(await confirmToast(')
    const loopAt    = body.indexOf('for (const a of targets) {')
    const loopEnd   = body.indexOf('if (ok.size) onSuccess(ok)')
    expect(confirmAt).toBeGreaterThan(-1)
    expect(loopAt).toBeGreaterThan(confirmAt)
    expect(body.indexOf('setBulkSaving(true)')).toBeGreaterThan(confirmAt)
    expect(body.slice(loopAt, loopEnd)).toContain('await work(a)')
    expect(body).not.toMatch(/Promise\.all|\.forEach\(|\.map\(/)
    // No toast inside the loop; the summary follows it.
    expect(body.slice(loopAt, loopEnd)).not.toContain('toast')
    expect(body.slice(loopEnd)).toContain('toast.success(`${label}: ${ok.size} done`)')
    expect(body.slice(loopEnd)).toContain('toast.error(`${label}: ${fail} failed')
    // The per-row request helper reports nothing on its own.
    expect(between(src, 'const patchAction', 'const bulkApprove')).not.toContain('toast')
    expect(src).toContain("const bulkApprove = () => bulkRun('Approve'")
  })

  it('/admin/events/[id]/participants: approveAll and promoteBatch confirm before runBatch', () => {
    const src = read('app/admin/events/[id]/participants/page.tsx')
    for (const [start, end] of [['async function approveAll(', 'async function promoteBatch('], ['async function promoteBatch(', 'async function approveAttendee(']]) {
      const fn = between(src, start, end)
      const confirmAt = fn.indexOf('if (!(await confirmToast(')
      expect(confirmAt).toBeGreaterThan(-1)
      expect(fn.indexOf('await runBatch(')).toBeGreaterThan(confirmAt)
      expect(fn).not.toContain('fetch(')
    }
    expect(src).toContain('onClick={() => approveAll(pending)}')
    expect(src).toContain('onClick={() => promoteBatch(waitlist.slice(0, event.spotsLeft))}')
  })

  it('/admin/events/[id]/participants runBatch: one request at a time, one summary after the loop', () => {
    const body = between(read('app/admin/events/[id]/participants/page.tsx'), 'async function runBatch(', 'async function approveAll(')
    const loopAt  = body.indexOf('for (const userId of userIds) {')
    const afterAt = body.indexOf('} finally {')
    expect(loopAt).toBeGreaterThan(-1)
    expect(afterAt).toBeGreaterThan(loopAt)
    expect(body.slice(loopAt, afterAt)).toContain('const res = await fetch(')
    expect(body).not.toMatch(/Promise\.all|\.forEach\(|\.map\(/)
    expect(body.slice(0, afterAt)).not.toContain('toast')
    const summary = body.slice(afterAt)
    expect(summary).toContain('if (failed === 0) toast.success(')
    expect(summary).toContain('else if (ok === 0) toast.error(')
    expect(summary).toContain('else toast.warning(')
  })
})
