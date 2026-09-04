// Client-side image downscale. The transport caps (Next middleware +
// nginx, both 20 MB) refuse large iPhone HEIC/JPEG uploads before they
// ever reach the upload route, so callers run a picked file through
// here first. Scales the long edge to
// maxEdge and re-encodes as JPEG. Falls back to the original file if
// any step fails (decode/draw/encode) so the caller still attempts the
// upload — the server's sharp pipeline can still recover smaller files.
// Thrown for failures the user can actually act on — callers show
// .message verbatim instead of a generic "upload failed".
export class ImageUploadError extends Error {}

export async function downscaleImage(file: File, maxEdge = 1600, quality = 0.85): Promise<File> {
  // iOS Safari hands over 0-byte files when the photo lives in iCloud
  // ("Optimize iPhone Storage") and isn't downloaded to the device.
  // Uploading it would fail downstream with a misleading format error.
  if (file.size === 0) {
    throw new ImageUploadError("That photo couldn't be read from your device — if it's stored in iCloud, open it once in the Photos app (to download it), then try again.")
  }
  if (!file.type.startsWith('image/')) return file

  // Decode with the EXIF Orientation tag APPLIED.
  //
  // This canvas re-encode strips EXIF (canvas.toBlob writes none), so
  // whatever orientation is baked into these pixels is final: the upload
  // route's sharp .rotate() reads the tag, and by then there is no tag left
  // to read. Drawing an <img> alone is not enough — the browser default for
  // image-orientation has changed over time and is not reliable across the
  // Safari versions members actually use — so a photo taken upside down
  // (Orientation 3) was stored upside down, with nothing downstream able to
  // tell. createImageBitmap takes the instruction explicitly; where it is
  // unsupported we fall back to the <img>, which is no worse than before.
  const url = URL.createObjectURL(file)
  let bitmap: ImageBitmap | null = null
  let source: CanvasImageSource
  let srcW: number
  let srcH: number
  const img = document.createElement('img')
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      source = bitmap
      srcW   = bitmap.width
      srcH   = bitmap.height
    } catch {
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve()
        img.onerror = () => reject(new Error('decode failed'))
        img.src     = url
      })
      source = img
      srcW   = img.naturalWidth
      srcH   = img.naturalHeight
    }
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
    // Skip re-encode for already-small files; saves a CPU pass and
    // preserves the original (no lossy round-trip for tiny avatars).
    // Safe for orientation: this returns the file UNTOUCHED, EXIF and all,
    // so the upload route's sharp .rotate() still has the tag to act on.
    // ONLY for formats the server accepts as-is — a small HEIC/AVIF
    // (e.g. iPhone photo with a .jpg name) must still go through the
    // canvas so it leaves here as real JPEG; passing it through raw
    // gets it rejected by the server's magic-byte sniff even though
    // this browser could have converted it.
    const SERVER_SAFE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (scale >= 1 && file.size < 4 * 1024 * 1024 && SERVER_SAFE.includes(file.type)) return file

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(srcW * scale)
    canvas.height = Math.round(srcH * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas ctx')
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )
    if (!blob) throw new Error('encode failed')
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    // Decode/encode failed (common for HEIC outside Safari). Falling back
    // to the raw file is fine when it can survive transport — the server's
    // sharp pipeline may still recover it, and if not the upload route
    // returns a clean, actionable 400. But past nginx's 20MB cap the
    // request dies as an unreadable transport error, so fail fast here
    // with a message the upload UIs can show verbatim.
    if (file.size > 19 * 1024 * 1024) {
      throw new ImageUploadError("This photo couldn't be processed in your browser and is too large to upload as-is. Please convert it to JPG or PNG first.")
    }
    return file
  } finally {
    bitmap?.close()
    URL.revokeObjectURL(url)
  }
}
