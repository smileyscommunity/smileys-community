// Client-side image downscale. Next's 10 MB body limit refuses large
// iPhone HEIC/JPEG uploads before they ever reach the upload route, so
// callers run a picked file through here first. Scales the long edge to
// maxEdge and re-encodes as JPEG. Falls back to the original file if
// any step fails (decode/draw/encode) so the caller still attempts the
// upload — the server's sharp pipeline can still recover smaller files.
export async function downscaleImage(file: File, maxEdge = 1600, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const img = document.createElement('img')
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve()
      img.onerror = () => reject(new Error('decode failed'))
      img.src     = url
    })
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    // Skip re-encode for already-small files; saves a CPU pass and
    // preserves the original (no lossy round-trip for tiny avatars).
    if (scale >= 1 && file.size < 4 * 1024 * 1024) return file

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(img.naturalWidth  * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas ctx')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )
    if (!blob) throw new Error('encode failed')
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
