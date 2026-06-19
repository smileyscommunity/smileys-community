import { NextRequest, NextResponse } from 'next/server'
import { readFile, access } from 'fs/promises'
import { join, extname, normalize } from 'path'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import sharp from 'sharp'

export const runtime = 'nodejs'

// Allowlist of resize widths the file route will produce on demand.
// Anything else (or no `?w=` at all) serves the original. Bounded
// allowlist + immutable cache means each variant is computed at
// most once per (file, width) per process / CDN cache window.
const SIZED: ReadonlySet<number> = new Set([64, 96, 128, 256])

const MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
}

const UPLOAD_ROOT = join(process.cwd(), 'public', 'uploads')
const VALID_FOLDERS = ['events', 'clubs', 'users', 'general', 'applications', 'posts', 'neighborhoods', 'directory', 'listings']
const VALID_FILE = /^[\w\-]+\.(jpg|jpeg|png|webp|gif)$/i

// Tiny in-process cache: filename → boolean (is an approved
// member's active profile photo). Was firing a Prisma count() on
// every applications/* request — the cup leaderboard renders 10
// avatars at once, so cold cache = 10 sequential DB roundtrips
// behind 10 image fetches. Cache cuts those to one query per file
// per process per TTL. Memory cost is bounded by member count;
// each entry is a string key + bool. Reset on cold-start / deploy.
const APPROVED_PHOTO_CACHE = new Map<string, { ok: boolean; expires: number }>()
const APPROVED_TTL_MS = 5 * 60 * 1000

async function isApprovedProfilePhoto(filename: string): Promise<boolean> {
  const now    = Date.now()
  const cached = APPROVED_PHOTO_CACHE.get(filename)
  if (cached && cached.expires > now) return cached.ok
  const count = await prisma.user.count({
    where: { profilePhoto: { endsWith: `applications/${filename}` }, status: 'approved' },
  })
  const ok = count > 0
  APPROVED_PHOTO_CACHE.set(filename, { ok, expires: now + APPROVED_TTL_MS })
  return ok
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (path.length !== 2) return new NextResponse('Not found', { status: 404 })
  const [folder, file] = path
  if (!VALID_FOLDERS.includes(folder) || !VALID_FILE.test(file)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Applications folder: gate enumeration of rejected/pending
  // applicant photos. Approved-member photos are semi-public
  // (rendered on member directory, events, cup leaderboard, etc.)
  // so the check is the same for unauth and logged-in non-admins —
  // both branches collapse to one cached lookup.
  if (folder === 'applications') {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      if (!(await isApprovedProfilePhoto(file))) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    }
    // Admins/moderators: unrestricted
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
  const wantSized  = width !== null && SIZED.has(width)
  let body: Buffer | Uint8Array = raw
  let mime = MIME[ext] ?? 'application/octet-stream'
  if (wantSized) {
    try {
      body = await sharp(raw).resize(width, width, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
      mime = 'image/jpeg'
    } catch {
      // Corrupted or unsupported file — fall back to the raw bytes.
      // Better to serve the original than a silent 500 that shows
      // a broken image or blank slot in the UI.
    }
  }

  // Profile photos are semi-public (shown on member/event pages). Cache aggressively.
  // Applications folder is more conservative since it can include rejected applicants.
  const maxAge = folder === 'applications' ? 3600 : 86400 * 7

  // Cast to Uint8Array — Buffer<ArrayBufferLike> no longer
  // satisfies BodyInit under TS 5.x's stricter Buffer typing.
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': `public, max-age=${maxAge}, immutable`,
    },
  })
}
