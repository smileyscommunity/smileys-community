import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { toast } from 'sonner'
import { sendNotificationAction, setReadFor, restoreAt } from '@/lib/notificationActions'
import { prepareImageUpload, rawImageSizeError, uploadSizeError, MAX_RAW_IMAGE_BYTES, MAX_UPLOAD_BYTES } from '@/lib/imageUploadGuard'
import { ImageUploadError } from '@/lib/image-resize'

const read = (p: string) => readFileSync(p, 'utf-8')
const MB = 1024 * 1024

// Items 92 and 93 — bell / say hi / vibe picker, club + hangout photos,
// club fetches, rich-text toolbar keyboard access.

describe('92a. notification actions report failure and roll back', () => {
  beforeEach(() => { vi.mocked(toast.error).mockClear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('resolves true on an OK response without toasting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
    expect(await sendNotificationAction('PATCH', { markAll: true }, 'Could not mark all as read')).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })
  it("resolves false and toasts the server's own message on a refusal", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Too many requests"}', { status: 429 })))
    expect(await sendNotificationAction('DELETE', { id: 'n1' }, 'Could not dismiss notification')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Too many requests')
  })
  it('falls back when the body is not JSON (nginx 502)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })))
    expect(await sendNotificationAction('PATCH', { id: 'n1' }, 'Could not mark as read')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not mark as read')
  })
  it('resolves false (never throws) when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await sendNotificationAction('PATCH', { id: 'n1' }, 'Could not mark as read')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not mark as read — check your connection')
  })

  const list = [
    { id: 'a', isRead: false }, { id: 'b', isRead: true }, { id: 'c', isRead: false },
  ]
  it('setReadFor flips only the given ids, both ways', () => {
    const ids = new Set(['a', 'c'])
    const read1 = setReadFor(list, ids, true)
    expect(read1.map(n => n.isRead)).toEqual([true, true, true])
    // rollback restores exactly the ones that were unread — 'b' stays read
    expect(setReadFor(read1, ids, false).map(n => n.isRead)).toEqual([false, true, false])
  })
  it('restoreAt puts a dismissed row back in place, without duplicating a polled-back one', () => {
    const without = list.filter(n => n.id !== 'b')
    expect(restoreAt(without, list[1], 1).map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(restoreAt(list, list[1], 1)).toBe(list)
    expect(restoreAt([], list[1], 5).map(n => n.id)).toEqual(['b'])
  })

  it.each(['components/NotificationBell.tsx', 'app/(member)/notifications/page.tsx'])('%s goes through the checked action with rollback', (file) => {
    const src = read(file)
    // no more fire-and-forget PATCH/DELETE whose response nobody reads
    expect(src).not.toMatch(/await fetch\('\/app\/api\/notifications', \{\s*method: '(PATCH|DELETE)'/)
    expect(src).not.toMatch(/body: JSON\.stringify\(\{ id: n\.id \}\),\s*\}\)\.catch\(\(\) => \{\}\)/)
    // `.finally(settle)`: scan 6 batch 22 releases the poll overlay before any rollback.
    expect(src).toMatch(/if \(!await sendNotificationAction\('PATCH', \{ markAll: true \}[^)]*\)(?:\.finally\(settle\))?\) \{\s*set\w+\(prev => setReadFor\(prev, ids, false\)\)/)
    expect(src).toMatch(/if \(!await sendNotificationAction\('DELETE', \{ id \}[^)]*\)(?:\.finally\(settle\))?\) \{\s*set\w+\(prev => restoreAt\(prev, removed, index\)\)/)
    expect(src).toMatch(/sendNotificationAction\('PATCH', \{ id: n\.id \}[^)]*\)(?:\.finally\(settle\))?\.then\(ok => \{\s*if \(!ok\) set\w+\(prev => setReadFor\(prev, ids, false\)\)/)
  })

  it('say hi toasts a network failure instead of silently resetting', () => {
    const src = read('components/SayHiButton.tsx')
    expect(src).toMatch(/if \(!res\.ok\) \{ toast\.error\(data\.error \?\? 'Could not send'\); return \}/)
    expect(src).toMatch(/\} catch \{[^}]*toast\.error\('Could not send — check your connection'\)\s*\} finally \{\s*setSending\(false\)/)
  })
})

describe('92b. vibe picker always leaves the loading state', () => {
  const src = read('components/VibePicker.tsx')
  it('tracks status explicitly and settles it in finally', () => {
    expect(src).toMatch(/useState<'loading' \| 'error' \| 'ready'>\('loading'\)/)
    expect(src).toMatch(/\} finally \{\s*setStatus\(ok \? 'ready' : 'error'\)/)
    expect(src).toMatch(/const d = res\.ok \? await res\.json\(\) : null/)
    // an empty group list is no longer the loading condition
    expect(src).not.toMatch(/if \(!groups\.length\) return/)
  })
  it('shows an error with a retry', () => {
    expect(src).toMatch(/if \(status === 'error'\) return \(/)
    expect(src).toMatch(/<button type="button" onClick=\{loadTags\}[^>]*>Try again<\/button>/)
  })
})

describe('93a. size limits apply after the downscaler', () => {
  const fake = (size: number) => ({ size, type: 'image/jpeg', name: 'p.jpg' }) as File

  it('lets a large camera photo through when the downscaled result fits', async () => {
    const downscale = vi.fn(async () => fake(800 * 1024))
    const out = await prepareImageUpload(fake(14 * MB), downscale)
    expect(downscale).toHaveBeenCalledOnce()
    expect(out.size).toBe(800 * 1024)
  })
  it('refuses an absurd raw file before decoding it', async () => {
    const downscale = vi.fn(async (f: File) => f)
    await expect(prepareImageUpload(fake(MAX_RAW_IMAGE_BYTES + 1), downscale)).rejects.toBeInstanceOf(ImageUploadError)
    expect(downscale).not.toHaveBeenCalled()
  })
  it('refuses when the downscaler could not shrink it under the server cap', async () => {
    // e.g. an undecodable HEIC that downscaleImage hands back raw
    const err = await prepareImageUpload(fake(9 * MB), async () => fake(9 * MB)).catch(e => e)
    expect(err).toBeInstanceOf(ImageUploadError)
    expect(err.message).toMatch(/still over 5 MB after shrinking/)
  })
  it('bounds are inclusive and mirror the upload route', () => {
    expect(rawImageSizeError(MAX_RAW_IMAGE_BYTES)).toBeNull()
    expect(uploadSizeError(MAX_UPLOAD_BYTES)).toBeNull()
    expect(uploadSizeError(MAX_UPLOAD_BYTES + 1)).not.toBeNull()
    expect(read('app/api/upload/route.ts')).toMatch(/const MAX_SIZE = 5 \* 1024 \* 1024/)
    expect(MAX_UPLOAD_BYTES).toBe(5 * MB)
  })
  it('lets a downscaler error (iCloud-only photo) through untouched', async () => {
    const icloud = new ImageUploadError('open it in Photos first')
    await expect(prepareImageUpload(fake(3 * MB), async () => { throw icloud })).rejects.toBe(icloud)
  })

  it('ImageUpload no longer checks the raw file against 5 MB before downscaling', () => {
    const src = read('components/ImageUpload.tsx')
    expect(src).not.toMatch(/file\.size > 5 \* 1024 \* 1024/)
    expect(src).not.toMatch(/allowed\.includes\(file\.type\)/)
    const prep = src.indexOf('await prepareImageUpload(file)')
    expect(prep).toBeGreaterThan(-1)
    expect(src.indexOf('allowed.includes(upload.type)')).toBeGreaterThan(prep)
    expect(src).toMatch(/err instanceof ImageUploadError \? err\.message/)
  })
  it.each([
    'components/ClubPhotos.tsx',
    'components/RichTextEditor.tsx',
    'app/(member)/hangouts/page.tsx',
  ])('%s uploads through prepareImageUpload and shows its message', (file) => {
    const src = read(file)
    expect(src).not.toMatch(/await downscaleImage\(file\)/)
    expect(src).toMatch(/await prepareImageUpload\(file\)/)
    expect(src).toMatch(/err instanceof ImageUploadError/)
  })
  it('the hangouts page guards both the composer and the edit photo', () => {
    expect(read('app/(member)/hangouts/page.tsx').match(/await prepareImageUpload\(file\)/g)).toHaveLength(2)
  })
})

describe('93b. club delete controls work without hover', () => {
  it('club photo delete is visible on small / no-hover screens and on focus', () => {
    const src = read('components/ClubPhotos.tsx')
    expect(src).not.toMatch(/opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/)
    expect(src).toMatch(/aria-label="Delete photo"[^>]*opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus:opacity-100 \[@media\(hover:none\)\]:opacity-100/)
    // Enter on the button must not bubble into the tile's open-lightbox handler
    expect(src).toMatch(/onKeyDown=\{e => e\.stopPropagation\(\)\}\s*aria-label="Delete photo"/)
  })
  it('club resource remove is labelled and finger-sized', () => {
    const src = read('components/ClubResources.tsx')
    expect(src).toMatch(/aria-label=\{`Remove \$\{r\.title\}`\}/)
    expect(src).toMatch(/w-8 h-8 sm:w-6 sm:h-6/)
  })
})

describe('93c. club fetches surface failure', () => {
  it.each([
    ['components/ClubPhotos.tsx', 'photos'],
    ['components/ClubMembers.tsx', 'members'],
    ['components/ClubPastEvents.tsx', 'past events'],
    ['components/ClubReviews.tsx', 'reviews'],
    ['components/ClubAnnouncements.tsx', null],
    ['components/ClubConversations.tsx', 'conversations'],
  ])('%s rejects a non-OK load into an error state with retry', (file, noun) => {
    const src = read(file)
    expect(src).toMatch(/\.then\(r => r\.ok \? r\.json\(\) : Promise\.reject\(new Error\(`HTTP \$\{r\.status\}`\)\)\)/)
    expect(src).toMatch(/\.catch\(\(\) => setLoadError\(true\)\)/)
    expect(src).toMatch(/setReloadKey\(k => k \+ 1\)/)
    if (noun) expect(src).toContain(`Couldn&apos;t load ${noun}`)
  })
  it('announcements render the load error before the empty state', () => {
    const src = read('components/ClubAnnouncements.tsx')
    expect(src.indexOf('loadError ? (')).toBeGreaterThan(-1)
    // lastIndexOf: the rendered copy, not the WHY comment that quotes it
    expect(src.indexOf('loadError ? (')).toBeLessThan(src.lastIndexOf('No announcements yet.'))
  })
  it.each([
    ['components/ClubPhotos.tsx', 'Could not delete the photo'],
    ['components/ClubResources.tsx', 'Could not remove the resource'],
    ['components/ClubAnnouncements.tsx', 'Could not delete the announcement'],
  ])('%s toasts a refused delete', (file, msg) => {
    const src = read(file)
    expect(src).toContain(`if (!res.ok) { await toastApiError(res, '${msg}'); return }`)
    expect(src).toContain(`toast.error('${msg} — check your connection')`)
  })
  it('the clubs grid does not fail open to "No clubs found"', () => {
    const src = read('app/clubs/ClubsClient.tsx')
    expect(src).toMatch(/fetch\(`\/app\/api\/clubs\$\{cityQs\}`, \{ credentials: 'include' \}\)\.then\(r => r\.ok \? r\.json\(\) : null\)/)
    expect(src).toMatch(/setLoadError\(!Array\.isArray\(clubData\)\)/)
    expect(src.indexOf(') : loadError ? (')).toBeLessThan(src.indexOf("'No clubs found'"))
  })
  it('club hangouts and the spotlight picker say when they failed', () => {
    const hang = read('components/ClubHangouts.tsx')
    expect(hang).toMatch(/if \(!id \|\| !hs\) \{ setFailed\(true\); return \}/)
    expect(hang).toMatch(/\{failed \? \(/)
    const spot = read('components/ClubSpotlight.tsx')
    expect(spot).toMatch(/\.catch\(\(\) => setError\("Couldn't load club members[^"]*"\)\)\s*\.finally\(\(\) => setLoadingMembers\(false\)\)/)
  })
})

describe('93d. rich-text toolbar is keyboard operable', () => {
  const src = read('components/RichTextEditor.tsx')
  it('toolbar buttons act on click and only preventDefault on mousedown', () => {
    const btn = src.slice(src.indexOf('function ToolbarBtn'), src.indexOf('export default function RichTextEditor'))
    expect(btn).toMatch(/onMouseDown=\{e => e\.preventDefault\(\)\}\s*onClick=\{onClick\}/)
    expect(btn).toMatch(/aria-label=\{title\}/)
    expect(btn).toMatch(/aria-pressed=\{active\}/)
  })
  it('no control anywhere in the editor runs its action inside onMouseDown', () => {
    expect(src).not.toMatch(/onMouseDown=\{e => \{\s*e\.preventDefault\(\);?\s*[^}\s]/)
    expect(src.match(/onMouseDown=\{e => e\.preventDefault\(\)\}/g)!.length).toBeGreaterThanOrEqual(4)
  })
  it('one-shot actions are not announced as toggles', () => {
    expect(src).not.toMatch(/<ToolbarBtn active=\{false\}/)
    expect(src).toMatch(/aria-label=\{c\.value \? `Text colour: \$\{c\.label\}` : 'Default text colour'\}/)
    expect(src).toMatch(/aria-label="Close link editor"/)
  })
})
