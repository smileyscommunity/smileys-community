import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { inAppPath } from '@/hooks/useUnsavedChangesGuard'
import { socialStyleLabel, SOCIAL_STYLES } from '@/lib/socialStyles'

const read = (p: string) => readFileSync(p, 'utf8')
const ORIGIN = 'https://smileys.example'

describe('unsaved-changes guard: which links it holds', () => {
  it('maps an in-app link to the router path (basePath stripped, query and hash kept)', () => {
    expect(inAppPath(`${ORIGIN}/app/settings`, ORIGIN)).toBe('/settings')
    expect(inAppPath(`${ORIGIN}/app/pro?ref=profile#top`, ORIGIN)).toBe('/pro?ref=profile#top')
    expect(inAppPath(`${ORIGIN}/app`, ORIGIN)).toBe('/')
  })
  it('lets other origins and pages outside basePath through (beforeunload covers those)', () => {
    expect(inAppPath('https://instagram.com/someone', ORIGIN)).toBeNull()
    expect(inAppPath(`${ORIGIN}/`, ORIGIN)).toBeNull()
    expect(inAppPath(`${ORIGIN}/apply`, ORIGIN)).toBeNull()
    expect(inAppPath(`${ORIGIN}/application`, ORIGIN)).toBeNull()
  })
})

describe('social styles', () => {
  it('labels every picker option and nothing it does not know', () => {
    for (const s of SOCIAL_STYLES) expect(socialStyleLabel(s.id)).toBe(s.label)
    expect(socialStyleLabel('retired_style')).toBeNull()
  })
})

describe('profile editor', () => {
  const src = read('app/(member)/profile/page.tsx')
  it('builds the neighbourhood picker from the home city, not the browsed one', () => {
    expect(src).toMatch(/useCityNeighborhoods\(home\?\.slug \?\? null\)/)
    expect(src).not.toMatch(/useCityNeighborhoods\(\)/)
    expect(src).not.toMatch(/useCurrentCity/)
  })
  it('never renders the form after a failed load', () => {
    expect(src).toMatch(/loadError \? \(/)
    expect(src).toMatch(/Retry/)
  })
  it('does not update the photo locally unless the PATCH succeeded', () => {
    const upload = src.slice(src.indexOf('async function handlePhotoUpload'), src.indexOf('async function handleRemovePhoto'))
    expect(upload.indexOf('if (!saveRes.ok)')).toBeGreaterThan(-1)
    expect(upload.indexOf('if (!saveRes.ok)')).toBeLessThan(upload.indexOf('commitPhoto('))
  })
  it('offers exactly the gender values the API accepts', () => {
    for (const v of ['female', 'male', 'non_binary', 'prefer_not_to_say']) expect(src).toContain(`value: '${v}'`)
    expect(src).not.toMatch(/<option value="other">/)
  })
  it('uses no native dialogs', () => {
    expect(src).not.toMatch(/\b(window\.)?(confirm|alert|prompt)\(/)
  })
})

describe('member profile', () => {
  const src = read('app/(member)/members/[id]/MemberProfileClient.tsx')
  it('renders a locked view with none of the other sections', () => {
    for (const guard of ['!locked && references.length', '!locked && member.bio', '!locked && member.clubs.length', '!locked && member.upcomingEvents.length']) {
      expect(src).toContain(guard)
    }
  })
  it('keeps Instagram, LinkedIn and work details to the full view', () => {
    expect(src).toMatch(/viewLevel === 'full' && \(member\.instagram \|\| member\.linkedin\)/)
    expect(src).toMatch(/Instagram, LinkedIn and work details are for connections\./)
  })
  it('refetches after accepting, and links the hangout badge to the hangout', () => {
    expect(src).toMatch(/setConnStatus\('accepted'\)[\s\S]{0,300}await loadProfile\(\)/)
    expect(src).toMatch(/href=\{`\/hangouts\/\$\{hangout\.id\}`\}/)
  })
  it('sets the bookmark from the server answer', () => {
    expect(src).toMatch(/setIsSaved\(data\.saved\)/)
  })
  it('uses no native dialogs', () => {
    expect(src).not.toMatch(/\b(window\.)?(confirm|alert|prompt)\(/)
  })
})
