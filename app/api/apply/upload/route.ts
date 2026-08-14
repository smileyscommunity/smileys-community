import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { detectImageFormat } from '@/lib/imageMagic'
import { uploadRoot } from '@/lib/uploadRoot'

export const runtime = 'nodejs'

const ALLOWED  = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_SIZE = 4 * 1024 * 1024 // 4MB

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`apply-upload:${getIp(req)}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429 })
    }

    // Pre-check the body size before calling formData(). Next's middleware
    // body cap is 10 MB; anything larger gets truncated and req.formData()
    // throws a generic "Failed to parse body as FormData" — applicants on
    // iPhones (a single photo often sits at 5–8 MB and HEIC→JPEG re-encode
    // can push past 10) would see an opaque "Upload failed" toast. Bail
    // early with an actionable 413 so the apply form can show a real
    // message instead of bouncing the user to support.
    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > 12 * 1024 * 1024) {
      return NextResponse.json({ error: 'Photo too large. Please upload an image under 4 MB.' }, { status: 413 })
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      // The body was truncated or malformed before parsing — same actionable
      // message rather than a generic 500.
      return NextResponse.json({ error: 'Photo too large. Please upload an image under 4 MB.' }, { status: 413 })
    }
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Photo too large. Please upload an image under 4 MB.' }, { status: 413 })

    const ext = extname(file.name).toLowerCase()
    if (!ALLOWED.includes(ext)) return NextResponse.json({ error: 'JPG or PNG only' }, { status: 400 })

    const filename  = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`
    const uploadDir = join(uploadRoot(), 'applications')
    mkdirSync(uploadDir, { recursive: true })
    const raw = Buffer.from(await file.arrayBuffer())

    // Magic-byte sniff before Sharp — see lib/imageMagic.ts.
    if (!detectImageFormat(raw)) {
      return NextResponse.json({ error: 'File is not a valid image' }, { status: 400 })
    }

    let buffer: Buffer
    try {
      // .rotate() reads EXIF Orientation from the original buffer to fix camera
      // rotation, then removes it. .jpeg() strips all remaining EXIF (GPS etc).
      buffer = await sharp(raw).rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    } catch {
      return NextResponse.json({ error: 'Could not process image' }, { status: 400 })
    }
    writeFileSync(join(uploadDir, filename), buffer)

    return NextResponse.json({ url: `/app/api/files/applications/${filename}` })
  } catch (e) {
    console.error('Apply upload error:', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
