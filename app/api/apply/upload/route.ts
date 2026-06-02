import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { detectImageFormat } from '@/lib/imageMagic'

export const runtime = 'nodejs'

const ALLOWED  = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_SIZE = 4 * 1024 * 1024 // 4MB

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`apply-upload:${getIp(req)}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429 })
    }
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Max 4MB' }, { status: 400 })

    const ext = extname(file.name).toLowerCase()
    if (!ALLOWED.includes(ext)) return NextResponse.json({ error: 'JPG or PNG only' }, { status: 400 })

    const filename  = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`
    const uploadDir = join(process.cwd(), 'public', 'uploads', 'applications')
    mkdirSync(uploadDir, { recursive: true })
    const raw = Buffer.from(await file.arrayBuffer())

    // Magic-byte sniff before Sharp — see lib/imageMagic.ts.
    if (!detectImageFormat(raw)) {
      return NextResponse.json({ error: 'File is not a valid image' }, { status: 400 })
    }

    let buffer: Buffer
    try {
      // Sharp's .jpeg() re-encode strips EXIF (incl. GPS) by default.
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
