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

export interface StoredAnnouncement {
  text:      string
  link:      string
  active:    boolean
  updatedAt: string | null
  updatedBy: string | null
  /**
   * 'admin' when the POST route wrote it. Anything else — including absent,
   * which is every announcement written before this field existed — means the
   * file was changed some other way, so nothing guarantees the text is within
   * the cap or the link passed isSafeHref. The admin page says so rather than
   * presenting an unchecked banner as if the form had produced it.
   */
  updatedVia: string | null
}

export const EMPTY_ANNOUNCEMENT: StoredAnnouncement = {
  text:       '',
  link:       '',
  active:     false,
  updatedAt:  null,
  updatedBy:  null,
  updatedVia: null,
}

/** Written by the POST route, and only by it. */
export const ADMIN_SOURCE = 'admin'

/**
 * Normalise whatever is on disk into the stored shape. Every field is checked
 * for its own type: a hand-edited file is not a hypothetical here, and a
 * missing file, invalid JSON or a number where a string belongs all come back
 * as the empty announcement rather than reaching a consumer.
 */
export function readAnnouncement(): StoredAnnouncement {
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
  } catch { return { ...EMPTY_ANNOUNCEMENT } }
}

/** The banner the dashboard should show, or null when there is nothing to show. */
export function liveAnnouncement(): StoredAnnouncement | null {
  const a = readAnnouncement()
  return a.active && a.text ? a : null
}

/**
 * True when something is live that the admin form did not produce, so the
 * page can say the text and link were never checked. An empty announcement is
 * not "unverified" — there is nothing to verify.
 *
 * Takes the two fields it reads rather than the whole record, so the admin
 * page's own client-side type (where updatedVia is optional, since a response
 * cached before the field existed will not carry it) satisfies it too.
 */
export function setOutsideTheApp(a: { updatedAt: string | null; updatedVia?: string | null }): boolean {
  return !!a.updatedAt && a.updatedVia !== ADMIN_SOURCE
}
