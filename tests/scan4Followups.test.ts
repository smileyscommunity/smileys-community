import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Follow-ups to scan 4 items 29–31 that landed outside the agents' files.
const read = (p: string) => readFileSync(p, 'utf8')

describe('the 48h orphan-upload reaper cannot strand an application', () => {
  it('the apply API refuses a photo link whose file is gone', () => {
    const src = read('app/api/apply/route.ts')
    expect(src).toMatch(/existsSync\(join\(uploadRoot\(\), 'applications', photoFile\)\)/)
    expect(src).toMatch(/photoFile\.includes\('\.\.'\)/)
    expect(src).toContain('Your photo upload has expired')
  })
  it('the browser draft neither stores nor restores the uploaded photo', () => {
    const src = read('app/apply/ApplyClient.tsx')
    expect(src).toContain("form: { ...form, profilePhoto: '' }, interests")
    expect(src).toContain("setForm(f => ({ ...f, ...d.form, profilePhoto: '' }))")
    expect(src).not.toMatch(/setPhotoPreview\(d\.photoPreview\)/)
  })
  it('the sweep is watched by the cron staleness check', () => {
    expect(read('lib/cronHealth.ts')).toMatch(/'sweep-orphan-uploads':\s*24 \* 60/)
  })
})

describe('invite page', () => {
  it('no longer reads the neighborhood the API stopped sending', () => {
    expect(read('app/(member)/invite/page.tsx')).not.toContain('m.neighborhood')
  })
})
