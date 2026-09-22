import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

// 2026-09-22. A broadcast can carry one image. It shows in the email and on
// the in-app announcement card, and nowhere else: web push's `image` renders
// on Chrome/Android only — iOS and Safari ignore it — and push reaches 13% of
// the membership, so a lock-screen billboard would be effort spent on the
// smallest audience. The compact rows in the bell stay text on purpose too:
// the notifications list is not a feed.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('where a broadcast image may come from', () => {
  it('our own uploads only — an external src would hand a third party every reader\'s IP', () => {
    expect(isUploadedImageUrl('/app/api/files/broadcasts/1788-abc.jpg', ['broadcasts'])).toBe(true)
    expect(isUploadedImageUrl('https://evil.example/p.gif', ['broadcasts'])).toBe(false)
    // …and not some other folder's file dressed up as a broadcast image.
    expect(isUploadedImageUrl('/app/api/files/applications/a.jpg', ['broadcasts'])).toBe(false)
    expect(isUploadedImageUrl('/app/api/files/messages/a.jpg', ['broadcasts'])).toBe(false)
  })

  it('the route refuses anything else before a single send goes out', () => {
    const route = src('app/api/admin/notifications/broadcast/route.ts')
    expect(route).toContain("if (cleanImage && !isUploadedImageUrl(cleanImage, ['broadcasts'])) {")
    // Refused while parsing the body — before claimOnce, so a rejected
    // attempt doesn't burn the idempotency key its corrected retry needs.
    expect(route.indexOf('isUploadedImageUrl(cleanImage')).toBeLessThan(route.indexOf('claimOnce(claimKey'))
  })

  it('the folder is uploadable, servable and referenceable — all three lists agree', () => {
    expect(src('app/api/upload/route.ts')).toContain("'messages', 'broadcasts']")
    expect(src('app/api/files/[...path]/route.ts')).toContain("'messages', 'broadcasts']")
    expect(src('lib/uploadedImageUrl.ts')).toContain("'guide', 'broadcasts'] as const")
  })
})

describe('where it shows', () => {
  it('in the email, absolute — a mail client has no origin to resolve a rooted path against', () => {
    const email = src('lib/email.ts')
    expect(email).toContain('const imageHtml = imageUrl')
    // No ?w= — the upload already stored a 1200px q82 file, so the resize
    // branch would decode and re-encode it once per recipient per open.
    expect(email).toContain('${esc(`${SITE_URL}${imageUrl}`)}')
    expect(email).not.toContain('${imageUrl}?w=')
    // …and a blocked-image client is told what the picture was.
    expect(email).toContain('alt="${esc(title)}"')
    // APP_URL already ends in /app and so does the stored path.
    expect(email).not.toContain('${APP_URL}${imageUrl}')
    expect(email).toContain('${imageHtml}')
  })

  it('on the in-app announcement card, and not in the compact rows', () => {
    const page = src('app/(member)/notifications/page.tsx')
    expect(page).toContain('n.imageUrl')
    // One image render, on the announcement card only.
    expect((page.match(/n\.imageUrl/g) ?? []).length).toBeLessThanOrEqual(2)
  })

  it('never on the push — it would only render for a fraction of a fraction', () => {
    const notify = src('lib/notify.ts')
    expect(notify).toContain('sendPushToUser(userId, { title, body, link })')
    expect(notify).not.toMatch(/sendPushToUser\([^)]*imageUrl/)
    expect(src('public/sw.js')).not.toContain('payload.image')
  })
})

describe('the ways it could go out wrong', () => {
  const composer = src('app/admin/notifications/page.tsx')

  it('an upload still in flight blocks the send — an email cannot be recalled', () => {
    expect(composer).toContain('    !uploadingImage &&')
    expect(composer).toContain('disabled={sending || uploadingImage}')
  })

  it('an upload that lands after the send does not attach itself to the next broadcast', () => {
    expect(composer).toContain('const uploadGen = useRef(0)')
    expect(composer).toContain('const gen = ++uploadGen.current')
    expect(composer).toContain('if (gen !== uploadGen.current) return')
    // Clearing the image retires the upload running for it, too.
    expect(composer).toContain('function clearImage() {')
    expect(composer).toContain('uploadGen.current++')
  })

  it('an unreadable photo says which photo problem it was', () => {
    expect(composer).toContain('e instanceof ImageUploadError ? e.message')
  })

  it('the card shows the whole poster rather than a centre band of it', () => {
    const page = src('app/(member)/notifications/page.tsx')
    expect(page).toContain('object-contain')
    expect(page).not.toContain('max-h-64 object-cover')
  })

  it('an edit can correct or remove the image on the rows it can still reach', () => {
    const route = src('app/api/admin/notifications/broadcast/route.ts')
    expect(route).toContain('if (imageUrl !== undefined) {')
    expect(route).toContain('imagePatch = { imageUrl: clean || null }')
    // Both the fanned-out rows and the send record.
    expect((route.match(/\.\.\.imagePatch/g) ?? []).length).toBe(2)
  })

  it('the thumbnails ask for a sized variant, not the original', () => {
    expect(composer).toContain('avatarUrl(b.imageUrl, 64)')
    expect(src('app/(member)/notifications/page.tsx')).toContain('${n.imageUrl}?w=800')
  })

  it('what passes validation is what the file route will serve', () => {
    // The validator used to allow a dot in the stem and the file route did
    // not — a path that passed on write then 403'd in every inbox.
    expect(isUploadedImageUrl('/app/api/files/broadcasts/a.b.jpg', ['broadcasts'])).toBe(false)
    expect(isUploadedImageUrl('/app/api/files/broadcasts/1788-ab12cd.jpg', ['broadcasts'])).toBe(true)
  })
})

describe('what is stored', () => {
  it('on the notification row and on the send record', () => {
    expect(src('lib/notify.ts')).toContain('imageUrl: opts?.imageUrl ?? null')
    expect(src('app/api/admin/notifications/broadcast/route.ts')).toContain('imageUrl: image,')
  })

  it('carried as an options object, not an eighth positional argument', () => {
    expect(src('lib/notify.ts')).toContain('opts?: { imageUrl?: string | null },')
    expect(src('app/api/admin/notifications/broadcast/route.ts'))
      .toContain('prefsBy.get(u.id) ?? null, { imageUrl: image })')
  })

  it('and reaches the member surfaces through the one feed type', () => {
    expect(src('lib/notificationFeed.ts')).toContain('imageUrl:  string | null')
  })

  it('the migration is additive and nullable on both tables', () => {
    const sql = src('prisma/migrations/20260922000001_broadcast_image/migration.sql')
    expect(sql).toContain('ALTER TABLE "broadcasts"    ADD COLUMN "imageUrl" TEXT;')
    expect(sql).toContain('ALTER TABLE "notifications" ADD COLUMN "imageUrl" TEXT;')
    // Nothing backfills: every existing row correctly carried no image.
    expect(sql).not.toMatch(/UPDATE|NOT NULL|DEFAULT/)
  })
})
