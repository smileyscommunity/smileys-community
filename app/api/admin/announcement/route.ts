import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { writeFileSync, renameSync } from 'fs'
import {
  ANNOUNCEMENT_FILE as filePath, ADMIN_SOURCE, EMPTY_ANNOUNCEMENT as EMPTY,
  readAnnouncement as read, type StoredAnnouncement,
} from '@/lib/announcement'

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
  // Admin-only: there is one announcement and every city's dashboard shows
  // it, so a city-scoped moderator writing it would speak for the network.
  if (!session || !isAdmin(session)) {
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
    // Stamped so the admin page can tell a banner this form produced — and
    // therefore capped and isSafeHref-checked — from one written straight to
    // the file on the server, which is how the 2026-09-19 announcement got
    // there. See lib/announcement.
    updatedVia: ADMIN_SOURCE,
  }
  // Atomic write — write to .tmp then rename, so a partially-written
  // JSON never gets read by a concurrent GET.
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(payload, null, 2))
  renameSync(tmp, filePath)
  writeAudit(session.id, session.name, 'announcement.set', undefined, 'announcement',
    { text: cleanText, link: rawLink, active: !!active },
    `${active ? 'Set' : 'Cleared'} the site announcement${cleanText ? `: "${cleanText.slice(0, 80)}"` : ''}`,
  )
  return NextResponse.json({ ok: true, updatedAt: payload.updatedAt, updatedBy: payload.updatedBy, updatedVia: payload.updatedVia })
}
