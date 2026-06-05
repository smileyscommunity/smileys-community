import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { getSession } from '@/lib/session'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { detectImageFormat } from '@/lib/imageMagic'

export const runtime = 'nodejs'

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`upload:${getIp(req)}`, 20, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429 })
    }
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Your session has expired — please log in again.' }, { status: 403 })
    }

    const formData = await req.formData()
    const file   = formData.get('file')   as File | null
    const folder = formData.get('folder') as string | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Admins and moderators can upload anywhere
    const isPrivileged = ['admin', 'moderator'].includes(session.role)

    // Club hosts (role = 'member' at account level but 'host' in a club) can upload event images
    let isClubHost = false
    if (!isPrivileged && folder !== 'users') {
      const hostMembership = await prisma.clubMembership.findFirst({
        where: { userId: session.id, role: 'host', status: 'approved' },
        select: { id: true },
      })
      isClubHost = !!hostMembership
    }

    // Regular members can upload event/club/hangout photos; downstream API
    // routes enforce per-feature auth (e.g. the hangouts POST checks the
    // returned URL against a regex before storing).
    const isMemberUpload = folder === 'events' || folder === 'clubs' || folder === 'hangouts'

    if (!isPrivileged && !isClubHost && !isMemberUpload && folder !== 'users') {
      return NextResponse.json({ error: 'You can only upload profile photos.' }, { status: 403 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
    }

    const ext = extname(file.name).toLowerCase()
    if (!ALLOWED.includes(ext)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP, GIF allowed' }, { status: 400 })
    }

    const validFolders = ['events', 'clubs', 'users', 'general', 'posts', 'hangouts', 'directory']
    const subfolder  = validFolders.includes(folder ?? '') ? folder! : 'general'
    const filename   = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`
    const uploadDir  = join(process.cwd(), 'public', 'uploads', subfolder)
    mkdirSync(uploadDir, { recursive: true })

    const raw = Buffer.from(await file.arrayBuffer())

    // Magic-byte sniff — reject anything whose content doesn't match an
    // allowed image format, regardless of the filename extension. Defense-
    // in-depth before Sharp's decoder, and fast-fails on PHP/script
    // payloads with image extensions.
    if (!detectImageFormat(raw)) {
      return NextResponse.json({ error: 'File is not a valid image (JPG, PNG, WebP, GIF)' }, { status: 400 })
    }

    let buffer: Buffer
    try {
      // Sharp's .jpeg() re-encode strips EXIF (including any GPS coords from
      // mobile photos) by default — the output buffer has no metadata. Don't
      // call .withMetadata() unless you intentionally want to keep it.
      buffer = await sharp(raw).rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    } catch {
      return NextResponse.json({ error: 'Could not process image. Please upload a valid JPG, PNG, WebP, or GIF.' }, { status: 400 })
    }
    writeFileSync(join(uploadDir, filename), buffer)

    return NextResponse.json({ url: `/app/api/files/${subfolder}/${filename}` })
  } catch (e) {
    console.error('Upload error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
