import { NextRequest, NextResponse } from 'next/server'
import { readFile, access } from 'fs/promises'
import { join, extname, normalize } from 'path'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { uploadRoot } from '@/lib/uploadRoot'
import { prisma } from '@/lib/prisma'
import sharp from 'sharp'

export const runtime = 'nodejs'

// Allowlist of resize widths the file route will produce on demand.
// Anything else (or no `?w=` at all) serves the original. Bounded
// allowlist + immutable cache means each variant is computed at
// most once per (file, width) per process / CDN cache window.
// SIZED: small square thumbs (avatar-shaped, fit: cover).
// PREVIEW: wider non-square fit-inside for OG/social-card previews
// where WhatsApp / iMessage / X drop images > ~600 KB.
const SIZED:   ReadonlySet<number> = new Set([64, 96, 128, 256])
const PREVIEW: ReadonlySet<number> = new Set([800, 1200])

const MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
}

// This route is the ONLY way to read an upload: the files sit outside public/
// precisely so Next can't serve them statically around this gate. See
// lib/uploadRoot.
const UPLOAD_ROOT = uploadRoot()
const VALID_FOLDERS = ['events', 'clubs', 'users', 'general', 'applications', 'posts', 'neighborhoods', 'directory', 'listings', 'hangouts', 'guide', 'reports', 'messages']
const VALID_FILE = /^[\w\-]+\.(jpg|jpeg|png|webp|gif)$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (path.length !== 2) return new NextResponse('Not found', { status: 404 })
  const [folder, file] = path
  if (!VALID_FOLDERS.includes(folder) || !VALID_FILE.test(file)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Applications folder holds raw applicant photos — including REJECTED and
  // PENDING applicants who never consented to a public avatar. It is strictly
  // admin/moderator-only. Approved members never serve their avatar from here:
  // approval promotes the photo into users/ (see lib/promotePhoto), so there is
  // no "approved member" exception to make. The previous version derived that
  // exception from the user-writable profilePhoto column, which let any
  // approved member unlock an arbitrary applicant photo by pointing their own
  // profilePhoto at it.
  //
  // reports/ is screenshot evidence attached to a member report — it can show
  // private DMs and names the reporter never meant to publish, and the reporter
  // was promised confidentiality. Same staff-only gate; the reporter previews
  // their own pick locally, so they never need to fetch it back.
  if (folder === 'applications' || folder === 'reports') {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // messages/ is a photo somebody sent in a private conversation. Only the two
  // people in it may fetch it — a DM photo has no business being readable by
  // anyone who comes across the URL, and it must not be cached by a proxy
  // either (the public branch below sets a week of shared caching).
  let privateFile = false
  if (folder === 'messages') {
    privateFile = true
    const session = await getSession()
    if (!session) return new NextResponse('Forbidden', { status: 403 })
    const url = `/app/api/files/messages/${file}`
    // No staff bypass: the DM route says plainly that no route serves a
    // member's messages to a moderator, and a photo is a message. Staff who
    // need one for a report get it through the report, not by URL.
    const seen = await prisma.directMessage.findFirst({
      where:  { imageUrl: url, deletedAt: null, OR: [{ fromId: session.id }, { toId: session.id }] },
      select: { id: true },
    })
    if (!seen) return new NextResponse('Forbidden', { status: 403 })
  }

  const filePath = normalize(join(UPLOAD_ROOT, folder, file))
  if (!filePath.startsWith(UPLOAD_ROOT + '/')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    await access(filePath)
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }

  const ext  = extname(filePath).toLowerCase()
  const raw  = await readFile(filePath)

  // Resize-on-demand for avatar-shaped uses. The cup leaderboard
  // (and any other small-avatar surface) renders 7×7 (~28px) but
  // the originals are 1200×1200 JPEG quality-82, ~150–300 KB each.
  // Sharp-resized 64-wide thumbs land at ~3 KB — ~50× less wire
  // bytes. Originals stay reachable without `?w` so existing URLs
  // keep working.
  const widthParam = req.nextUrl.searchParams.get('w')
  const width      = widthParam ? Number(widthParam) : null
  const wantSized   = width !== null && SIZED.has(width)
  const wantPreview = width !== null && PREVIEW.has(width)
  let body: Buffer | Uint8Array = raw
  let mime = MIME[ext] ?? 'application/octet-stream'
  if (wantSized) {
    try {
      // .rotate() before .resize(): honours an EXIF Orientation tag if one
      // ever reaches disk. Uploads bake orientation in and strip the tag, so
      // this is normally a no-op — and exactly what you want the day it isn't.
      body = await sharp(raw).rotate().resize(width, width, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
      mime = 'image/jpeg'
    } catch {
      // Corrupted or unsupported file — fall back to the raw bytes.
      // Better to serve the original than a silent 500 that shows
      // a broken image or blank slot in the UI.
    }
  } else if (wantPreview) {
    // Preserve aspect; resize to fit inside a width × width box (height
    // floats). JPEG quality 75 lands a 1200-wide variant under ~250 KB
    // for typical club covers — small enough that WhatsApp / iMessage
    // / X all keep the preview image. Originals stay reachable without
    // `?w` so existing links keep working.
    try {
      body = await sharp(raw).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
      mime = 'image/jpeg'
    } catch {
      // Fall back to raw on any sharp error.
    }
  }

  // Profile photos are semi-public (shown on member/event pages). Cache
  // aggressively. Applicant photos are admin/moderator-gated above —
  // `public` would let any shared cache (nginx proxy_cache, corporate
  // proxy, shared-machine browser) store the body and re-serve it to
  // viewers the route itself would 403.
  const cacheControl =
    folder === 'applications' || folder === 'reports' ? 'private, no-store'
    // A DM photo may be cached by the one browser that fetched it — five
    // minutes, so scrolling back through a thread doesn't re-fetch (and
    // re-check) it on every navigation — but never by a shared cache.
    : privateFile ? 'private, max-age=300'
    : `public, max-age=${86400 * 7}, immutable`

  // Cast to Uint8Array — Buffer<ArrayBufferLike> no longer
  // satisfies BodyInit under TS 5.x's stricter Buffer typing.
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': cacheControl,
    },
  })
}
