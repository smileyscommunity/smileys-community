import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// One <main> per page (2026-09-29). The root layout wraps every page in
// <main className="flex-1">, so a page, error screen or section layout that
// opened its own put a main landmark inside a main landmark — two "main"
// regions for a screen reader, one inside the other. Pages use a <div>.
// app/global-error.tsx renders its own <html>, outside the root layout.
const ALLOWED = new Set(['app/layout.tsx', 'app/global-error.tsx'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel, out)
    else if (rel.endsWith('.tsx')) out.push(rel)
  }
  return out
}

describe('single main landmark', () => {
  it('only the root layout (and the layout-less global error page) open <main>', () => {
    const offenders = [...walk('app'), ...walk('components')]
      .filter(f => !ALLOWED.has(f) && /<main\b/.test(readFileSync(join(process.cwd(), f), 'utf8')))
    expect(offenders).toEqual([])
  })
  it('the root layout still has it', () => {
    expect(readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')).toContain('<main className="flex-1">{children}</main>')
  })
})
