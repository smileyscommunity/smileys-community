// Promote an applicant photo out of the access-gated `applications/` folder
// into the semi-public `users/` folder, under a fresh unguessable name.
//
// Why this exists: applicant photos (including REJECTED and PENDING ones) live
// in uploads/applications/, which the file route gates. Approval used to copy
// the applications/ URL straight onto the new member's profilePhoto — so an
// approved member's avatar pointed back into the gated folder, and the gate
// then had to guess "is this filename an approved member's photo?" by trusting
// the user-writable profilePhoto column. That made the gate bypassable. The
// fix is to stop pointing member avatars at applications/ at all: at approval
// (and in a one-off backfill for existing members) the file is copied to
// users/ and the member's avatar points there instead.
//
// The new filename is freshly randomised so the old application filename can't
// be recovered from the member's public avatar URL.

import { copyFile, access } from 'fs/promises'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'

const UPLOAD_ROOT = join(process.cwd(), 'public', 'uploads')

// Stored profilePhoto values carry the /app basePath, e.g.
// `/app/api/files/applications/<name>.jpg`. Capture the filename only.
const APPLICATIONS_URL = /^\/app\/api\/files\/applications\/([\w-]+\.(?:jpg|jpeg|png|webp|gif))$/i

/**
 * If `url` is an applications/ photo URL, copy the file into users/ under a new
 * random name and return the new `/app/api/files/users/<name>` URL. Otherwise
 * (any other folder, null, or a malformed value) return the input unchanged.
 *
 * Never throws: a missing or unreadable source file returns the original URL
 * and logs, because a broken photo must not fail an approval or a backfill row
 * — a stale-but-gated avatar is a smaller problem than a blocked member.
 */
export async function promoteApplicationPhoto(url: string | null | undefined): Promise<string | null> {
  if (!url) return url ?? null
  const m = url.match(APPLICATIONS_URL)
  if (!m) return url

  const srcName = m[1]
  const src     = join(UPLOAD_ROOT, 'applications', srcName)
  const ext     = extname(srcName).toLowerCase()
  const newName = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`
  const dst     = join(UPLOAD_ROOT, 'users', newName)

  try {
    await access(src)
    await copyFile(src, dst)
  } catch (e) {
    console.error(`[promotePhoto] could not promote ${url}:`, e instanceof Error ? e.message : String(e))
    return url
  }
  return `/app/api/files/users/${newName}`
}
