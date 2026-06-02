/**
 * Magic-byte sniff for the image formats we accept. Defense-in-depth on top
 * of the extension check: a `.png`-named file containing arbitrary bytes
 * gets rejected here before it reaches Sharp. (Sharp itself would also
 * reject it, but its decoder is a large attack surface — fail fast on
 * obviously-wrong inputs.)
 *
 * Returns the detected format, or null if the buffer doesn't match any
 * allowed image format.
 */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif'

export function detectImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length < 12) return null

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png'

  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp'

  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'gif'

  return null
}
