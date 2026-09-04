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

type Decoded = {
  source: CanvasImageSource
  width:  number
  height: number
  release(): void
}

// Decode with the EXIF Orientation tag APPLIED.
//
// A canvas re-encode strips EXIF (canvas.toBlob writes none), so whatever
// orientation is baked into the drawn pixels is final: the upload route's
// sharp .rotate() reads the tag, and by then there is no tag left to read.
// Drawing an <img> alone is not enough — the browser default for
// image-orientation has changed over time and is not reliable across the
// Safari versions members actually use — so a photo taken upside down
// (Orientation 3) was stored upside down, with nothing downstream able to
// tell. createImageBitmap takes the instruction explicitly; where it is
// unsupported we fall back to the <img>, which is no worse than before.
async function decodeOriented(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
  } catch {
    const url = URL.createObjectURL(file)
    const img = document.createElement('img')
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve()
        img.onerror = () => reject(new Error('decode failed'))
        img.src     = url
      })
    } catch (e) {
      URL.revokeObjectURL(url)
      throw e
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  }
}

function toJpegFile(canvas: HTMLCanvasElement, name: string, quality: number): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob
        ? resolve(new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }))
        : reject(new Error('encode failed')),
      'image/jpeg',
      quality,
    )
  })
}

export async function downscaleImage(file: File, maxEdge = 1600, quality = 0.85): Promise<File> {
  // iOS Safari hands over 0-byte files when the photo lives in iCloud
  // ("Optimize iPhone Storage") and isn't downloaded to the device.
  // Uploading it would fail downstream with a misleading format error.
  if (file.size === 0) {
    throw new ImageUploadError("That photo couldn't be read from your device — if it's stored in iCloud, open it once in the Photos app (to download it), then try again.")
  }
  if (!file.type.startsWith('image/')) return file

  let decoded: Decoded | null = null
  try {
    decoded = await decodeOriented(file)
    const { source, width: srcW, height: srcH } = decoded
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
    // Skip re-encode for already-small files; saves a CPU pass and
    // preserves the original (no lossy round-trip for tiny avatars).
    // Safe for orientation ONLY because the file leaves here untouched,
    // EXIF and all, so the upload route's sharp .rotate() still has the
    // tag to act on. It is NOT safe for a file whose pixels are already
    // sideways with no tag to describe it — nothing downstream can see
    // that, which is why rotateImage() below never takes this shortcut.
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
    return await toJpegFile(canvas, file.name, quality)
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
    decoded?.release()
  }
}

/**
 * Re-encode `file` with its EXIF orientation applied AND `quarterTurns`
 * further 90° clockwise turns baked into the pixels.
 *
 * This is what a member's "rotate" control produces, and it deliberately
 * ALWAYS re-encodes — no small-file shortcut. Two reasons. The obvious one:
 * a turn the member asked for has to reach the bytes, and handing back the
 * original file would silently discard it. The subtler one: a photo whose
 * pixels are already sideways with no EXIF tag to say so — a screenshot, a
 * WhatsApp forward, anything rotated in an app that rewrites pixels — is
 * invisible to every automatic fix we have. sharp .rotate() reads a tag
 * that isn't there and correctly does nothing. Only a person can see that
 * one, so when a person tells us, we bake it in and leave no tag behind for
 * anything downstream to second-guess.
 *
 * quarterTurns 0 is therefore not a no-op: it normalises orientation, which
 * is what makes a preview trustworthy — what is drawn is what is stored.
 */
export async function rotateImage(file: File, quarterTurns = 0, maxEdge = 1600, quality = 0.85): Promise<File> {
  if (file.size === 0) {
    throw new ImageUploadError("That photo couldn't be read from your device — if it's stored in iCloud, open it once in the Photos app (to download it), then try again.")
  }
  const turns = (((quarterTurns % 4) + 4) % 4) as 0 | 1 | 2 | 3

  let decoded: Decoded | null = null
  try {
    decoded = await decodeOriented(file)
    const { source, width: srcW, height: srcH } = decoded
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
    const drawW = Math.round(srcW * scale)
    const drawH = Math.round(srcH * scale)

    const canvas = document.createElement('canvas')
    // A quarter turn swaps the canvas: the portrait shot becomes landscape.
    canvas.width  = turns % 2 ? drawH : drawW
    canvas.height = turns % 2 ? drawW : drawH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas ctx')
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((turns * Math.PI) / 2)
    ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH)
    return await toJpegFile(canvas, file.name, quality)
  } catch (e) {
    if (e instanceof ImageUploadError) throw e
    // Unlike downscaleImage there is no safe fallback to the original: it
    // would upload the photo the member just told us was the wrong way up.
    throw new ImageUploadError("This photo couldn't be opened in your browser. Please try a JPG or PNG.")
  } finally {
    decoded?.release()
  }
}
