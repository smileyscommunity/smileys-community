// ── The one validator for uploaded-image URLs ───────────────────────────────
// Before this existed, the "is this a legit /app/api/files/… URL?" regex was
// copy-pasted 14 times in 4 slightly different dialects — and the one
// security-relevant tightening (refusing the applications/ folder, where raw
// APPLICANT photos live: people who may have been rejected and never consented
// to a public avatar) existed in exactly one copy. A member-facing photo field
// could therefore point into applicant-photo space; the file 403s for guests
// at serve time, but staff viewing the row would see it, and the reference is
// wrong to store at all.
//
// Client components may import this — keep it pure (no prisma, no fs).

// Folders the uploads pipeline serves publicly. `applications` is deliberately
// NOT here — it is admin-gated at serve time and must never be referenced by
// member-facing content. Keep in sync with app/api/upload/route.ts
// (validFolders) and app/api/files/[...path]/route.ts (VALID_FOLDERS); the
// uploadFoldersServable test pins upload ⊆ servable, and publicFolders here is
// the member-referenceable subset.
const PUBLIC_FOLDERS = ['events', 'clubs', 'users', 'general', 'posts', 'neighborhoods', 'directory', 'listings', 'hangouts', 'guide'] as const

// A photo sent in a direct message. NOT public: the files route serves it only
// to the two people in that conversation, so it is never in PUBLIC_FOLDERS —
// pass it explicitly (isUploadedImageUrl(url, MESSAGE_FOLDERS)) from the DM
// route. Attaching a photo was broken outright before this existed: the
// composer uploaded to a folder nothing accepted, so members got "you can only
// upload profile photos", and an admin's upload landed in general/, which is
// served to anyone holding the URL.
export const MESSAGE_FOLDERS = ['messages'] as const

const EXT = '(jpg|jpeg|png|webp|gif)'

/**
 * True when `url` is a well-formed uploads-pipeline image URL in a publicly
 * servable folder. Pass `folders` to restrict further (e.g. ['guide'] for the
 * guide editor, ['general'] for city heroes).
 */
export function isUploadedImageUrl(url: unknown, folders: readonly string[] = PUBLIC_FOLDERS): boolean {
  if (typeof url !== 'string' || !url) return false
  const m = url.match(new RegExp(`^\\/app\\/api\\/files\\/([a-zA-Z0-9-]+)\\/[a-zA-Z0-9.-]+\\.${EXT}$`))
  if (!m) return false
  return folders.includes(m[1])
}
