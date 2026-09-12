import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

// Scan-4 items 15–16: admin controls a role can see but the API refuses,
// and the admin user page crashing on a non-2xx load.
describe('admin controls are only offered to roles the API accepts (item 15)', () => {
  it('applications: moderators get no row approve/reject and no bulk bar', () => {
    const src = read('app/admin/applications/page.tsx')
    expect(src).toContain("(app.status === 'pending' || app.status === 'hold') && !isMod ?")
    expect(src).toContain("tab === 'pending' && !isMod && (")
  })
  it('listings: create links, settings toggle, panel and fetch are admin-only', () => {
    const src = read('app/admin/listings/page.tsx')
    expect(src).toContain("const isAdmin = viewer?.role === 'admin'")
    expect(src).toMatch(/\{isAdmin && \(\s*<>\s*<Link href="\/admin\/listings\/new"/)
    expect(src).toMatch(/\{isAdmin && \(\s*<button\s*onClick=\{\(\) => setShowSettings/)
    expect(src).toContain('{showSettings && isAdmin && (')
    expect(src).toMatch(/if \(!isAdmin\) return\s*\n\s*fetch\('\/app\/api\/admin\/settings'/)
  })
  it('listings new/bulk pages refuse non-admins before rendering the form', () => {
    for (const p of ['app/admin/listings/new/page.tsx', 'app/admin/listings/bulk/page.tsx']) {
      const src = read(p)
      expect(src).toContain("if (user?.role !== 'admin') return (")
      expect(src).toMatch(/export default function \w+\(\) \{\s*\n\s*const \{ user, isLoading \} = useAuth\(\)/)
    }
  })
  it('guide: GET reports canEdit with the same gate as PUT, page disables Save on false', () => {
    const api = read('app/api/admin/guide/route.ts')
    expect(api).toContain('canEdit: canActInCity(session, await getDefaultCityId())')
    const page = read('app/admin/guide/page.tsx')
    expect(page).toContain('setCanEdit(d.canEdit !== false)')
    expect(page).toContain('disabled={saving || !dirty || !canEdit}')
    expect(page).toContain("if (!dirty || !canEdit) return")
  })
  it('user page: partner is a link to the partners page, not a refused role change', () => {
    const src = read('app/admin/users/[id]/page.tsx')
    expect(src).not.toContain("changeRole('partner')")
    expect(src).toMatch(/<Link href="\/admin\/partners"[^>]*>\s*→ Partner/)
  })
})

describe('admin user page survives a non-2xx load (item 16)', () => {
  const src = read('app/admin/users/[id]/page.tsx')
  it('checks r.ok before reading the body as a user', () => {
    expect(src).toMatch(/\.then\(async r => \{[\s\S]*?if \(!r\.ok\) \{[\s\S]*?return null[\s\S]*?return r\.json\(\)/)
    expect(src).toContain('if (!d) { setUser(null); return }')
  })
  it('never calls .join on a field that may be missing', () => {
    expect(src).not.toContain('d.languages.join(')
    expect(src).not.toContain('d.interests.join(')
    expect(src).toContain('(Array.isArray(d.languages) ? d.languages : []).join')
  })
})

describe('formatName is never passed straight to .map (locale param would get the index)', () => {
  it('lib/data.ts wraps it', () => {
    expect(read('lib/data.ts')).not.toMatch(/\.map\(formatName\)/)
  })
})
