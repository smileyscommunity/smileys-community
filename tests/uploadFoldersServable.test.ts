import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The upload route and the file-serving route each keep their own folder
// allowlist. When they drift, uploads land on disk but serving returns 404 —
// which surfaces to the admin as a broken preview that reads like "my image
// was rejected" (exactly how the 'guide' folder shipped: uploadable on
// 2026-08-20, not servable, and the bug report was "png doesn't work").
//
// A source guard because both lists are literals in route files — there's no
// shared module to import without coupling two routes that are otherwise
// independent, and the invariant is one-directional: everything uploadable
// must be servable (the reverse is fine — 'applications' and 'neighborhoods'
// are written by other paths and only served).

function extractList(file: string, constName: string): string[] {
  const src = readFileSync(join(process.cwd(), file), 'utf8')
  const m = src.match(new RegExp(`${constName}\\s*=\\s*\\[([^\\]]+)\\]`))
  if (!m) throw new Error(`${constName} not found in ${file}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

describe('every uploadable folder is servable', () => {
  it('upload validFolders ⊆ files VALID_FOLDERS', () => {
    const uploadable = extractList('app/api/upload/route.ts', 'const validFolders')
    const servable   = extractList('app/api/files/[...path]/route.ts', 'const VALID_FOLDERS')
    expect(uploadable.length).toBeGreaterThan(5)   // guard the guard
    const orphaned = uploadable.filter(f => !servable.includes(f))
    expect(orphaned, 'folders you can upload into but never read back').toEqual([])
  })
})
