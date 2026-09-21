import { readFileSync } from 'fs'
import { join } from 'path'

// The site announcement: one banner, shown on the member dashboard.
//
// It lives in a file rather than the database because deploy.sh excludes
// data/announcement.json from its rsync, so the live text survives a deploy
// the way the other admin-edited JSON does. The consequence is that it can be
// edited by hand on the server — and has been: the banner live on 2026-09-21
// was written straight to the file, bypassing the POST route's 300-character
// cap, its isSafeHref check and its audit entry.
//
// That is why this reader exists and why it is shared. The normalisation used
// to live inside the route, where the comment said it was there so "a corrupt
// file or a manually-edited JSON with the wrong types can't crash the
// consumers" — while the actual consumer, the dashboard, did its own
// JSON.parse and checked only `raw.active && raw.text`. A text that was not a
// string would have gone straight to the banner.

export const ANNOUNCEMENT_FILE = join(process.cwd(), 'data', 'announcement.json')

// Re-exported so server callers have one import. The definitions live in
// lib/announcementShared, which touches no filesystem, because the admin
// editor is a client component and this module imports `fs`.
export {
  EMPTY_ANNOUNCEMENT, ADMIN_SOURCE, setOutsideTheApp,
  type AnnouncementRecord, type AnnouncementRecord as StoredAnnouncement,
} from '@/lib/announcementShared'
import { EMPTY_ANNOUNCEMENT as EMPTY, type AnnouncementRecord } from '@/lib/announcementShared'

/**
 * Normalise whatever is on disk into the stored shape. Every field is checked
 * for its own type: a hand-edited file is not a hypothetical here, and a
 * missing file, invalid JSON or a number where a string belongs all come back
 * as the empty announcement rather than reaching a consumer.
 */
export function readAnnouncement(): AnnouncementRecord {
  try {
    const raw = JSON.parse(readFileSync(ANNOUNCEMENT_FILE, 'utf-8'))
    return {
      text:       typeof raw?.text       === 'string' ? raw.text       : '',
      link:       typeof raw?.link       === 'string' ? raw.link       : '',
      active:     raw?.active === true,
      updatedAt:  typeof raw?.updatedAt  === 'string' ? raw.updatedAt  : null,
      updatedBy:  typeof raw?.updatedBy  === 'string' ? raw.updatedBy  : null,
      updatedVia: typeof raw?.updatedVia === 'string' ? raw.updatedVia : null,
    }
  } catch { return { ...EMPTY } }
}

/** The banner the dashboard should show, or null when there is nothing to show. */
export function liveAnnouncement(): AnnouncementRecord | null {
  const a = readAnnouncement()
  return a.active && a.text ? a : null
}

