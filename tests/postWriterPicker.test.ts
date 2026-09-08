import { describe, it, expect, vi, beforeEach } from 'vitest'

// An article is credited to whoever saves it, which is how two of Nate's
// stories came out as "Smileys Admin" when he published from the admin
// account (2026-09-08). The editor now has a writer picker: an admin may
// credit any staff member; a moderator always writes as themselves.

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst: vi.fn() } } }))
import { prisma } from '@/lib/prisma'
import { pickWriter } from '@/lib/postWriter'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const admin = { id: 'a1', role: 'admin', name: 'Admin' } as any
const mod   = { id: 'm1', role: 'moderator', name: 'Mod' } as any

beforeEach(() => vi.clearAllMocks())

describe('pickWriter', () => {
  it('defaults to the signed-in account when nothing (or itself) is picked', async () => {
    expect(await pickWriter(admin, undefined)).toEqual({ ok: true, id: 'a1' })
    expect(await pickWriter(mod, '')).toEqual({ ok: true, id: 'm1' })
    expect(await pickWriter(mod, 'm1')).toEqual({ ok: true, id: 'm1' })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it('lets an admin credit a staff member, and only a staff member', async () => {
    ;(prisma.user.findFirst as any).mockResolvedValue({ id: 'n1' })
    expect(await pickWriter(admin, 'n1')).toEqual({ ok: true, id: 'n1' })
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'n1', role: { in: ['admin', 'moderator'] }, status: 'approved' },
    }))
    ;(prisma.user.findFirst as any).mockResolvedValue(null)
    expect(await pickWriter(admin, 'member-x')).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a moderator crediting someone else', async () => {
    expect(await pickWriter(mod, 'n1')).toMatchObject({ ok: false, status: 403 })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })
})

describe('the routes and the form use it', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
  it('create and update both go through pickWriter; update only when a writer was sent', () => {
    expect(read('app/api/admin/posts/route.ts')).toMatch(/authorId:\s+writer\.id/)
    const put = read('app/api/admin/posts/[id]/route.ts')
    expect(put).toMatch(/if \(authorId\) \{\n\s+const writer = await pickWriter\(session, authorId\)/)
    expect(put).toMatch(/\.\.\.writerPatch,/)
  })
  it('the form sends the pick only when one was made, and hides the picker without writers', () => {
    const form = read('app/admin/posts/PostForm.tsx')
    expect(form).toMatch(/\.\.\.\(authorId \? \{ authorId \} : \{\}\)/)
    expect(form).toMatch(/\{writers\.length > 0 && \(/)
    expect(form).toMatch(/\/app\/api\/admin\/posts\/writers/)
  })
})
