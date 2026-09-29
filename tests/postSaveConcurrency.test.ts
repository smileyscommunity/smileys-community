import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

// Both post editors send every field they loaded. On 2026-09-26 a form opened
// at ~20:15 UTC was saved at 20:16:59 to add a cover photo and silently put a
// Handbook correction written at 20:16:01 back the way it was. The PUT now
// takes the updatedAt the editor loaded and refuses (409) if the row moved.

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access', () => ({
  canManagePosts:      () => true,
  canActOnCityContent: () => true,
  isAdmin:             (s: any) => s?.role === 'admin',
}))
vi.mock('@/lib/stepUp', () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/audit',  () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyNewArticle: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/postWriter', () => ({ pickWriter: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    post: { findUnique: vi.fn(), update: vi.fn() },
    city: { findUnique: vi.fn() },
  },
}))

import { PUT } from '@/app/api/admin/posts/[id]/route'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

const LOADED    = new Date('2026-09-26T20:15:02.123Z')
const CORRECTED = new Date('2026-09-26T20:16:01.456Z')

const row = (updatedAt: Date) => ({
  id: 'p1', slug: 'lost-documents', title: 'Lost documents', excerpt: null, body: '<p>Corrected</p>',
  coverImage: null, status: 'published', category: 'Documents & Legal', kind: 'handbook',
  authorId: 'a1', cityId: null, country: 'TR', publishedAt: new Date('2026-09-20T00:00:00Z'), updatedAt,
})

const edit = (extra: Record<string, unknown>) => ({
  title: 'Lost documents', excerpt: '', body: '<p>Original</p>',
  coverImage: '/app/api/files/general/cover.jpg', status: 'published', category: 'Documents & Legal', ...extra,
})

class Req { constructor(private b: unknown) {} async json() { return this.b } }
const put = (b: unknown) => PUT(new Req(b) as never, { params: Promise.resolve({ id: 'p1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
  ;(prisma.post.update as any).mockImplementation(async ({ data }: any) => ({ ...row(new Date()), ...data }))
})

describe('post save — optimistic concurrency', () => {
  it('409s a form opened before someone else saved, and writes nothing', async () => {
    ;(prisma.post.findUnique as any).mockResolvedValue(row(CORRECTED))
    const res = await put(edit({ expectedUpdatedAt: LOADED.toISOString() }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/changed since you opened it — reload/)
    expect(prisma.post.update).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('409s a save that lands between the check and the write (the guard is in the UPDATE)', async () => {
    ;(prisma.post.findUnique as any).mockResolvedValue(row(LOADED))
    ;(prisma.post.update as any).mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }))
    const res = await put(edit({ expectedUpdatedAt: LOADED.toISOString() }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/changed since you opened it/)
  })

  it('saves when the version matches, guarding the write on it', async () => {
    ;(prisma.post.findUnique as any).mockResolvedValue(row(LOADED))
    const res = await put(edit({ expectedUpdatedAt: LOADED.toISOString() }))
    expect(res.status).toBe(200)
    expect(prisma.post.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1', status: 'published', updatedAt: LOADED },
    }))
  })

  it('refuses a save with no (or a garbled) version — that is the stale tab this exists for', async () => {
    ;(prisma.post.findUnique as any).mockResolvedValue(row(LOADED))
    for (const v of [undefined, '', 'yesterday', 12345]) {
      const res = await put(edit({ expectedUpdatedAt: v }))
      expect(res.status).toBe(400)
    }
    expect(prisma.post.update).not.toHaveBeenCalled()
  })
})

describe('non-content writes do not move updatedAt', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
  // Prisma's @updatedAt stamps any client update — a reader's view beacon
  // would 409 an open editor. These go through raw SQL, which it doesn't touch.
  it('view counter, new-article claim and "Reviewed today" are raw SQL', () => {
    expect(read('app/api/posts/[slug]/view/route.ts')).toMatch(/\$executeRaw`UPDATE "posts" SET "views" = "views" \+ 1/)
    expect(read('lib/notify.ts')).toMatch(/\$executeRaw`UPDATE "posts" SET "notifiedAt" =/)
    expect(read('app/api/admin/posts/[id]/reviewed/route.ts')).toMatch(/\$executeRaw`UPDATE "posts" SET "lastReviewedAt" =/)
  })
  // Three editors, not two: the story page's inline editor was missed when
  // the check went in, and every save from it was refused as "out of date".
  it('every editor sends the version it loaded', () => {
    expect(read('app/admin/posts/PostForm.tsx')).toMatch(/expectedUpdatedAt: initial\.updatedAt/)
    for (const file of ['app/handbook/[slug]/EditableArticle.tsx', 'components/ArticleInlineEditor.tsx']) {
      const inline = read(file)
      expect(inline).toMatch(/expectedUpdatedAt: loaded\.updatedAt/)
      // …and round-trip cover/status from the admin row, not the cached page props.
      expect(inline).toMatch(/coverImage: loaded\.coverImage/)
    }
  })
  it('no other client code saves a post without being in the list above', () => {
    const callers = execSync(`grep -rlF "api/admin/posts/\\\${" app components`, { encoding: 'utf8' })
      .split('\n').filter(f => f && !f.startsWith('app/api/'))
    for (const f of callers) {
      if (!/'PUT'/.test(read(f))) continue
      expect(['app/admin/posts/PostForm.tsx', 'app/handbook/[slug]/EditableArticle.tsx', 'components/ArticleInlineEditor.tsx']).toContain(f)
    }
  })
})
