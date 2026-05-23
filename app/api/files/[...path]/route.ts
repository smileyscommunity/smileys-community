import { NextRequest, NextResponse } from 'next/server'
import { readFile, access } from 'fs/promises'
import { join, extname, normalize } from 'path'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
}

const UPLOAD_ROOT = join(process.cwd(), 'public', 'uploads')
const VALID_FOLDERS = ['events', 'clubs', 'users', 'general', 'applications', 'posts', 'neighborhoods']
const VALID_FILE = /^[\w\-]+\.(jpg|jpeg|png|webp|gif)$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (path.length !== 2) return new NextResponse('Not found', { status: 404 })
  const [folder, file] = path
  if (!VALID_FOLDERS.includes(folder) || !VALID_FILE.test(file)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Applications folder: only gate access for unauthenticated visitors.
  // Approved members viewing event/member pages are fine — no DB query needed.
  if (folder === 'applications') {
    const session = await getSession()
    if (!session) {
      // Unauthenticated: only allow if the file is an active approved member's profile photo
      const isActiveProfilePhoto = await prisma.user.count({
        where: { profilePhoto: { endsWith: `applications/${file}` }, status: 'approved' },
      })
      if (isActiveProfilePhoto === 0) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    } else if (!isAdminOrModerator(session)) {
      // Logged-in member: allow if it's an approved member's photo (cached query is fast)
      const isActiveProfilePhoto = await prisma.user.count({
        where: { profilePhoto: { endsWith: `applications/${file}` }, status: 'approved' },
      })
      if (isActiveProfilePhoto === 0) {
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
  const mime = MIME[ext] ?? 'application/octet-stream'
  const data = await readFile(filePath)

  // Profile photos are semi-public (shown on member/event pages). Cache aggressively.
  // Applications folder is more conservative since it can include rejected applicants.
  const maxAge = folder === 'applications' ? 3600 : 86400 * 7

  return new NextResponse(data, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': `public, max-age=${maxAge}, immutable`,
    },
  })
}
