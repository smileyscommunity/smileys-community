import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promoteApplicationPhoto } from '@/lib/promotePhoto'

// promotePhoto resolves paths through lib/uploadRoot, which reads UPLOAD_DIR.
// Point it at a throwaway dir so the test copies real files without touching
// the repo or a real upload store.
let root: string
const origUploadDir = process.env.UPLOAD_DIR

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'promote-'))
  await mkdir(join(root, 'applications'), { recursive: true })
  await mkdir(join(root, 'users'), { recursive: true })
  process.env.UPLOAD_DIR = root
})

afterEach(async () => {
  if (origUploadDir === undefined) delete process.env.UPLOAD_DIR
  else process.env.UPLOAD_DIR = origUploadDir
  await rm(root, { recursive: true, force: true })
})

describe('promoteApplicationPhoto', () => {
  it('copies an applications photo into users/ under a new name and returns the new URL', async () => {
    await writeFile(join(root, 'applications', 'abc123.jpg'), 'IMG')
    const out = await promoteApplicationPhoto('/app/api/files/applications/abc123.jpg')

    expect(out).toMatch(/^\/app\/api\/files\/users\/\d+-[0-9a-f]{12}\.jpg$/)
    // Old application filename is not recoverable from the new URL.
    expect(out).not.toContain('abc123')
    // The file really landed in users/.
    const usersDir = await readdir(join(root, 'users'))
    expect(usersDir).toHaveLength(1)
  })

  it('leaves a users/ photo untouched — nothing to promote', async () => {
    const url = '/app/api/files/users/already-fine.jpg'
    expect(await promoteApplicationPhoto(url)).toBe(url)
  })

  it('leaves other folders (events, clubs) untouched', async () => {
    expect(await promoteApplicationPhoto('/app/api/files/events/e.jpg')).toBe('/app/api/files/events/e.jpg')
  })

  it('passes null/empty through unchanged', async () => {
    expect(await promoteApplicationPhoto(null)).toBeNull()
    expect(await promoteApplicationPhoto('')).toBe('')
  })

  it('returns the original URL (not a throw) when the source file is missing', async () => {
    // No file written — approval/backfill must not fail on a missing photo.
    const url = '/app/api/files/applications/ghost.jpg'
    expect(await promoteApplicationPhoto(url)).toBe(url)
  })

  it('does not treat a lookalike path as an applications photo', async () => {
    // Path traversal / nested segments don't match the strict single-file regex.
    const evil = '/app/api/files/applications/../users/x.jpg'
    expect(await promoteApplicationPhoto(evil)).toBe(evil)
  })
})
