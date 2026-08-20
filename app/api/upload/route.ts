import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { getSession } from '@/lib/session'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { detectImageFormat } from '@/lib/imageMagic'
import { uploadRoot } from '@/lib/uploadRoot'

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

    // Regular members can upload event/club/hangout/listing/directory
    // photos; downstream API routes enforce per-feature auth (e.g. the
    // hangouts POST checks the returned URL against a regex before
    // storing). Directory submissions go through admin review unless
    // the submitter is an admin, so misuse gets caught there.
    //
    // There used to be a club-host branch here that BYPASSED the folder
    // check entirely — any member holding a club-host membership could
    // upload into posts/, guide/, general/, anywhere. Its stated purpose
    // ("event images") was already covered by the member set below, so it
    // was pure privilege widening; removed rather than folder-scoped.
    const isMemberUpload = folder === 'events' || folder === 'clubs' || folder === 'hangouts' || folder === 'listings' || folder === 'directory'

    if (!isPrivileged && !isMemberUpload && folder !== 'users') {
      return NextResponse.json({ error: 'You can only upload profile photos.' }, { status: 403 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
    }

    const ext = extname(file.name).toLowerCase()
    if (!ALLOWED.includes(ext)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP, GIF allowed' }, { status: 400 })
    }

    const validFolders = ['events', 'clubs', 'users', 'general', 'posts', 'hangouts', 'directory', 'listings', 'guide']
    const subfolder  = validFolders.includes(folder ?? '') ? folder! : 'general'
    const filename   = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`
    const uploadDir  = join(uploadRoot(), subfolder)
    mkdirSync(uploadDir, { recursive: true })

    const raw = Buffer.from(await file.arrayBuffer())

    // iOS Safari sends 0-byte files for iCloud photos that aren't
    // downloaded to the device ("Optimize iPhone Storage"). Name and
    // mime type look valid, content is empty — call it out precisely
    // instead of letting the magic sniff misreport it as a bad format.
    if (raw.length === 0) {
      return NextResponse.json({ error: "The photo arrived empty — this usually means it's stored in iCloud and not on your phone. Open it once in the Photos app, then try again." }, { status: 400 })
    }

    // Magic-byte sniff — reject anything whose content doesn't match an
    // allowed image format, regardless of the filename extension. Defense-
    // in-depth before Sharp's decoder, and fast-fails on PHP/script
    // payloads with image extensions.
    if (!detectImageFormat(raw)) {
      // Log what actually arrived — name/type lie routinely (HEIC with a
      // .jpg name is the classic), and the magic bytes in the log are the
      // only way to diagnose a user's "can't upload" report after the fact.
      console.warn('[upload] magic-sniff reject', {
        name: file.name, type: file.type, size: file.size,
        head: raw.subarray(0, 12).toString('hex'),
      })
      return NextResponse.json({ error: 'This photo format isn\'t supported — we accept JPG, PNG, WebP and GIF. iPhone tip: screenshot the photo and upload that, or set Settings → Camera → Formats to "Most Compatible".' }, { status: 400 })
    }

    let buffer: Buffer
    try {
      // .rotate() must come BEFORE .jpeg() — it reads the EXIF Orientation tag
      // from the original buffer to auto-correct camera rotation, then removes
      // the tag from output. .jpeg() strips all remaining EXIF (incl. GPS).
      // Never call .withMetadata() here or GPS coords leak to the public URL.
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
