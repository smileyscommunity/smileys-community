import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Event flyers (2026-09-27): a poster shown whole on the event page, apart
// from the cover, which every surface crops to a banner.
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('event flyer', () => {
  it('is stored, validated and copied with a duplicate', () => {
    expect(read('prisma/schema.prisma')).toContain('flyerImage           String?')
    expect(read('app/api/admin/events/route.ts')).toContain("if (!safeLocalFile(flyerImage))  return NextResponse.json({ error: 'Invalid flyer image URL' }")
    expect(read('app/api/admin/events/[id]/route.ts')).toContain("if ('flyerImage'  in rest && !safeLocalFile(rest.flyerImage))")
    expect(read('lib/eventDuplicate.ts')).toContain("'flyerImage'")
    expect(read('lib/db.ts')).toContain('flyerImage:         e.flyerImage         ?? undefined,')
  })
  it('every event form can upload one', () => {
    for (const f of ['app/admin/events/new/page.tsx', 'app/admin/events/[id]/edit/page.tsx', 'app/host/events/new/page.tsx', 'app/host/events/[id]/edit/page.tsx']) {
      expect(read(f)).toContain('Flyer (optional) — shown uncropped on the event page')
    }
  })
  it('the event page shows it uncropped, linked full size', () => {
    const page = read('app/events/[id]/page.tsx')
    expect(page).toContain('{event.flyerImage && (')
    expect(page).toContain('object-contain')
  })
})
