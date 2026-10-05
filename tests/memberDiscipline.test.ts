import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { UNBAN_CLEARS } from '@/lib/memberDiscipline'

// Ban, unban and warn once (admin clean-up, 2026-09-27).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('one ban, one warn', () => {
  it('both routes ban through afterBan', () => {
    expect(read('app/api/admin/users/[id]/route.ts')).toContain('await afterBan({ userId: id,')
    expect(read('app/api/admin/moderation/[id]/route.ts')).toContain('await afterBan({')
  })
  it('both routes warn through warnMember, which notes it on the record', () => {
    expect(read('app/api/admin/users/[id]/warn/route.ts')).toContain('await warnMember({')
    expect(read('app/api/admin/moderation/[id]/route.ts')).toContain('await warnMember({')
    expect(read('lib/memberDiscipline.ts')).toContain('prisma.adminNote.create(')
  })
})

describe('unban', () => {
  it('clears the ban and any appeal, whichever screen sent it', () => {
    expect(UNBAN_CLEARS).toEqual({ banReason: null, bannedAt: null, appealStatus: null, appealNote: null, appealedAt: null })
    expect(read('app/api/admin/users/[id]/route.ts')).toContain('if (unbanning) Object.assign(allowed, UNBAN_CLEARS)')
  })
})
