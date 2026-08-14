import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { uploadRoot } from '@/lib/uploadRoot'

// The one invariant worth pinning: uploads must never resolve inside public/.
// If they do, Next serves every file as a static asset at /app/uploads/... with
// no session check, and the applications/ gate in app/api/files becomes
// decorative. See lib/uploadRoot and SECURITY.md invariant 15.

const orig = process.env.UPLOAD_DIR

afterEach(() => {
  if (orig === undefined) delete process.env.UPLOAD_DIR
  else process.env.UPLOAD_DIR = orig
})

describe('uploadRoot', () => {
  it('uses UPLOAD_DIR when set — that is how prod points outside the deploy root', () => {
    process.env.UPLOAD_DIR = '/root/smileys-uploads'
    expect(uploadRoot()).toBe('/root/smileys-uploads')
  })

  it('falls back to <cwd>/uploads, not public/, when UPLOAD_DIR is unset', () => {
    delete process.env.UPLOAD_DIR
    expect(uploadRoot()).toBe(join(process.cwd(), 'uploads'))
  })

  it('never resolves inside public/, set or unset', () => {
    delete process.env.UPLOAD_DIR
    expect(uploadRoot()).not.toContain(`${join('public', 'uploads')}`)
    process.env.UPLOAD_DIR = '   '   // whitespace-only is treated as unset
    expect(uploadRoot()).toBe(join(process.cwd(), 'uploads'))
  })
})
