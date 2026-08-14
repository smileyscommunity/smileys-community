// Where user-uploaded files live on disk.
//
// This deliberately resolves OUTSIDE the Next.js `public/` directory. Uploads
// used to sit in `public/uploads`, which meant Next served every one of them as
// a static asset at `/app/uploads/<folder>/<file>` — with no session check —
// alongside the gated `app/api/files/[...path]` route. That static twin handed
// out applicant photos (including rejected applicants') to logged-out requests
// and made the route's admin-only gate on `applications/` decorative. Keeping
// the files out of `public/` is what actually closes that: there is only one
// way to read an upload, and it goes through the route.
//
// In production set `UPLOAD_DIR` to an absolute path OUTSIDE the deploy root
// (`/root/smileys-uploads`), for the same reason `/root/db-backups` lives
// outside it: deploy.sh rsyncs with `--delete`, so anything under the repo that
// isn't in the local working copy gets wiped. deploy.sh refuses to restart the
// server if `UPLOAD_DIR` is missing from the server's .env — without that check
// an unset var would silently fall back to the path below, 404 every image, and
// write new uploads somewhere the next deploy deletes.
//
// The fallback is for local dev and tests: `<cwd>/uploads`, gitignored.

import { join } from 'path'

export function uploadRoot(): string {
  return process.env.UPLOAD_DIR?.trim() || join(process.cwd(), 'uploads')
}
