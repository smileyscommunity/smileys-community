import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 2026-09-29: white text on the brand amber-500 was 2.15:1 on every primary
// button (WCAG AA needs 4.5:1). White text now sits on amber-700 (5.0:1),
// hovering to amber-800; white buttons carry amber-700 text. This ratchet
// keeps a new element from bringing the old pairing back. An amber fill
// without text (bars, dots, tints) is fine and not matched.

const ROOTS = ['app', 'components']
const files: string[] = []
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(n)) files.push(p)
  }
}
ROOTS.forEach(r => walk(join(process.cwd(), r)))

const SEG   = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g
const WHITE = /(?<![\w:/-])text-white(?![\w-])/
const LIGHT_FILL  = /(?<![\w:/-])bg-amber-(300|400|500|600)(?![\w/-])/
const LIGHT_HOVER = /(?<![\w/-])hover:bg-amber-(300|400|500|600)(?![\w/-])/

describe('button contrast', () => {
  it('no class string puts white text on a light amber fill or hover', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.match(SEG) ?? []) {
        if (WHITE.test(m) && (LIGHT_FILL.test(m) || LIGHT_HOVER.test(m))) offenders.push(`${f.replace(process.cwd() + '/', '')}: ${m.slice(0, 100)}`)
      }
    }
    expect(offenders).toEqual([])
  })
  it('the shared button classes use the passing shades', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    const block = (name: string) => css.slice(css.indexOf(`.${name} {`), css.indexOf('}', css.indexOf(`.${name} {`)))
    expect(block('btn-primary')).toContain('bg-amber-700 hover:bg-amber-800 text-white')
    expect(block('btn-primary--lg')).toContain('bg-amber-700 hover:bg-amber-800 text-white')
    expect(block('btn-white')).toContain('text-amber-700')
    expect(block('btn-white')).not.toContain('text-amber-600')
  })
})
