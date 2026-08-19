import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'

const filePath = join(process.cwd(), 'data', 'announcement.json')

interface StoredAnnouncement {
  text:      string
  link:      string
  active:    boolean
  updatedAt: string | null
  updatedBy: string | null
}

const EMPTY: StoredAnnouncement = {
  text:      '',
  link:      '',
  active:    false,
  updatedAt: null,
  updatedBy: null,
}

// Normalize whatever's on disk into the StoredAnnouncement shape so a
// corrupt file or a manually-edited JSON with the wrong types can't
// crash the consumers. Defensive on every read — cheap and avoids
// downstream null deref in the dashboard / admin form.
function read(): StoredAnnouncement {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return {
      text:      typeof raw?.text      === 'string'  ? raw.text      : '',
      link:      typeof raw?.link      === 'string'  ? raw.link      : '',
      active:    raw?.active === true,
      updatedAt: typeof raw?.updatedAt === 'string'  ? raw.updatedAt : null,
      updatedBy: typeof raw?.updatedBy === 'string'  ? raw.updatedBy : null,
    }
  } catch { return EMPTY }
}

export async function GET() {
  // Public + member components (AnnouncementBanner) read this, so no auth gate
  // — but a guest shouldn't see an unpublished (active:false) draft's text, nor
  // the staff name in updatedBy. Staff get the raw record for the editor.
  const session = await getSession()
  const stored  = read()
  if (session && isAdminOrModerator(session)) return NextResponse.json(stored)
  if (!stored.active) return NextResponse.json({ ...EMPTY })
  return NextResponse.json({ ...stored, updatedBy: null })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { text, link, active } = await req.json()
  const cleanText = String(text ?? '').trim().slice(0, 300)
  const rawLink   = String(link ?? '').trim().slice(0, 2000)

  // Use the shared isSafeHref allowlist — same one banners and sponsors
  // use. Previously the inline check accepted any string starting with
  // `/`, which let `//evil.com` (protocol-relative URL → resolves to
  // https://evil.com when rendered as an href) bypass validation.
  if (rawLink && !isSafeHref(rawLink)) {
    return NextResponse.json({ error: 'Link must be a relative path (/path) or an https:// URL' }, { status: 400 })
  }

  const payload: StoredAnnouncement = {
    text:      cleanText,
    link:      rawLink,
    active:    !!active,
    updatedAt: new Date().toISOString(),
    updatedBy: session.name,
  }
  // Atomic write — write to .tmp then rename, so a partially-written
  // JSON never gets read by a concurrent GET.
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(payload, null, 2))
  renameSync(tmp, filePath)
  return NextResponse.json({ ok: true, updatedAt: payload.updatedAt, updatedBy: payload.updatedBy })
}
