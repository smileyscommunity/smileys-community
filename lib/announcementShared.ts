// The parts of the announcement contract that both sides need.
//
// Kept apart from lib/announcement because that one reads the file and so
// imports `fs`, and the admin editor at app/admin/announcements is a client
// component. Importing the reader from there pulled `fs` into the browser
// bundle and broke the build — which neither tsc nor vitest catches, since
// only next build resolves the client boundary.

export interface AnnouncementRecord {
  text:      string
  link:      string
  active:    boolean
  updatedAt: string | null
  updatedBy: string | null
  /**
   * 'admin' when the POST route wrote it. Anything else — including absent,
   * which is every announcement written before this field existed — means the
   * file was changed some other way, so nothing guarantees the text is within
   * the cap or the link passed isSafeHref.
   */
  updatedVia: string | null
}

export const EMPTY_ANNOUNCEMENT: AnnouncementRecord = {
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
