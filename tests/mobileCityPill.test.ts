import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('mobile header city pill', () => {
  it('the phone header carries the compact city menu, like the desktop bar', () => {
    const nav = src('components/Navbar.tsx')
    const mobile = nav.slice(nav.indexOf('{/* Mobile right */}'))
    expect(mobile).toContain('variant="compact"')
  })
  it('the compact variant names the current city and renders nothing without one', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain("variant === 'compact'")
    expect(m).toContain('if (!current) return null')
    expect(m).toContain('{current.name}')
  })

  it('the sheet dims the page, locks scroll, and documents its header dependency', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('bg-black/25')
    expect(m).toContain("document.body.style.overflow = 'hidden'")
    expect(m).toContain('backdrop-blur')
  })
})
