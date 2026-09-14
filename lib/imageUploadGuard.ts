import { downscaleImage, ImageUploadError } from '@/lib/image-resize'

// Size limits for member photo uploads, applied in the right ORDER.
//
// A modern phone camera photo is routinely 6–15 MB. Checking the raw file
// against the server's 5 MB cap rejected exactly those photos, even though
// downscaleImage would have shrunk them to well under a megabyte. So the
// raw file only has to clear a generous sanity bound (decoding a 60 MB
// panorama can crash a phone's tab); the real limit applies to what we
// actually send.

// Raw input ceiling — well above any phone camera, below "that's a RAW file".
export const MAX_RAW_IMAGE_BYTES = 40 * 1024 * 1024
// Mirrors MAX_SIZE in app/api/upload/route.ts. Checked client-side only so
// the member gets a clear message instead of a generic "upload failed".
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export function rawImageSizeError(size: number): string | null {
  return size > MAX_RAW_IMAGE_BYTES
    ? 'That photo is too large (over 40 MB). Please pick a smaller photo or take a screenshot of it.'
    : null
}

export function uploadSizeError(size: number): string | null {
  return size > MAX_UPLOAD_BYTES
    ? "That photo is still over 5 MB after shrinking it. Please convert it to JPG or pick a smaller photo."
    : null
}

type Downscale = (file: File) => Promise<File>

// Raw bound → downscale → server bound. Throws ImageUploadError (whose
// message callers show verbatim) for anything the member can act on.
export async function prepareImageUpload(file: File, downscale: Downscale = downscaleImage): Promise<File> {
  const rawErr = rawImageSizeError(file.size)
  if (rawErr) throw new ImageUploadError(rawErr)
  const out = await downscale(file)
  const outErr = uploadSizeError(out.size)
  if (outErr) throw new ImageUploadError(outErr)
  return out
}
