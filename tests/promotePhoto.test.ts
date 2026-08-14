import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir, access, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// promotePhoto resolves paths from process.cwd()/public/uploads. Point cwd at
// a throwaway dir so the test copies real files without touching the repo.
let root: string
const origCwd = process.cwd

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'promote-'))
  await mkdir(join(root, 'public', 'uploads', 'applications'), { recursive: true })
  await mkdir(join(root, 'public', 'uploads', 'users'), { recursive: true })
  process.cwd = () => root
  vi.resetModules()
})

afterEach(async () => {
  process.cwd = origCwd
  await rm(root, { recursive: true, force: true })
})

async function load() {
  return (await import('@/lib/promotePhoto')).promoteApplicationPhoto
}

describe('promoteApplicationPhoto', () => {
  it('copies an applications photo into users/ under a new name and returns the new URL', async () => {
    await writeFile(join(root, 'public', 'uploads', 'applications', 'abc123.jpg'), 'IMG')
    const promote = await load()
    const out = await promote('/app/api/files/applications/abc123.jpg')

    expect(out).toMatch(/^\/app\/api\/files\/users\/\d+-[0-9a-f]{12}\.jpg$/)
    // Old application filename is not recoverable from the new URL.
    expect(out).not.toContain('abc123')
    // The file really landed in users/.
    const usersDir = await readdir(join(root, 'public', 'uploads', 'users'))
    expect(usersDir).toHaveLength(1)
  })

  it('leaves a users/ photo untouched — nothing to promote', async () => {
    const promote = await load()
    const url = '/app/api/files/users/already-fine.jpg'
    expect(await promote(url)).toBe(url)
  })

  it('leaves other folders (events, clubs) untouched', async () => {
    const promote = await load()
    expect(await promote('/app/api/files/events/e.jpg')).toBe('/app/api/files/events/e.jpg')
  })

  it('passes null/empty through unchanged', async () => {
    const promote = await load()
    expect(await promote(null)).toBeNull()
    expect(await promote('')).toBe('')
  })

  it('returns the original URL (not a throw) when the source file is missing', async () => {
    const promote = await load()
    // No file written — approval/backfill must not fail on a missing photo.
    const url = '/app/api/files/applications/ghost.jpg'
    expect(await promote(url)).toBe(url)
  })

  it('does not treat a lookalike path as an applications photo', async () => {
    const promote = await load()
    // Path traversal / nested segments don't match the strict single-file regex.
    const evil = '/app/api/files/applications/../users/x.jpg'
    expect(await promote(evil)).toBe(evil)
  })
})
