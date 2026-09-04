import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { downscaleImage, rotateImage, ImageUploadError } from '@/lib/image-resize'

// These cover the orientation contract, not pixel output: a real canvas is not
// available under vitest's node environment, so the fakes below record what the
// code ASKS the canvas to do. That is the part that has actually gone wrong —
// a turn applied in the wrong direction, or a quarter turn that forgets to swap
// the canvas and crops the photo to a square.

type Recorded = [string, ...unknown[]]

let recorded: Recorded[]
let canvas: { width: number; height: number; getContext: () => unknown; toBlob: (cb: (b: Blob | null) => void) => void }

function stubBrowser(bitmapW: number, bitmapH: number) {
  recorded = []
  const ctx = {
    translate: (x: number, y: number) => recorded.push(['translate', x, y]),
    rotate:    (a: number)            => recorded.push(['rotate', a]),
    drawImage: (...args: unknown[])   => recorded.push(['drawImage', ...args.slice(1)]),
  }
  canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' })),
  }
  vi.stubGlobal('createImageBitmap', async () => ({ width: bitmapW, height: bitmapH, close: () => {} }))
  vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'canvas' ? canvas : {}) })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} })
}

const jpeg = (bytes = 1000) => new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' })

afterEach(() => vi.unstubAllGlobals())

describe('rotateImage', () => {
  beforeEach(() => stubBrowser(1200, 900))

  it('turns clockwise: one turn right is +90°, not -90°', async () => {
    await rotateImage(jpeg(), 1)
    expect(recorded).toContainEqual(['rotate', Math.PI / 2])
  })

  it('swaps the canvas on a quarter turn so nothing is cropped', async () => {
    await rotateImage(jpeg(), 1)
    // source is 1200x900 landscape; a quarter turn must leave a 900x1200 portrait
    expect(canvas.width).toBe(900)
    expect(canvas.height).toBe(1200)
  })

  it('keeps the canvas as-is for a half turn', async () => {
    await rotateImage(jpeg(), 2)
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(900)
    expect(recorded).toContainEqual(['rotate', Math.PI])
  })

  it('draws the image centred on the rotation origin', async () => {
    await rotateImage(jpeg(), 1)
    expect(recorded).toContainEqual(['translate', 450, 600])
    expect(recorded).toContainEqual(['drawImage', -600, -450, 1200, 900])
  })

  it('normalises a negative turn rather than rotating backwards', async () => {
    await rotateImage(jpeg(), -1)
    expect(recorded).toContainEqual(['rotate', (3 * Math.PI) / 2])
  })

  it('wraps a full revolution back to no turn', async () => {
    await rotateImage(jpeg(), 4)
    expect(recorded).toContainEqual(['rotate', 0])
  })

  // The bug this whole control exists for: a small JPEG whose pixels are
  // already sideways with no EXIF tag. downscaleImage hands it straight
  // through (nothing downstream can see the problem), so rotateImage must
  // NOT inherit that shortcut or the member's turn is silently dropped.
  it('always re-encodes, even for a small JPEG that downscaleImage would pass through', async () => {
    const file = jpeg()
    const skipped = await downscaleImage(file)
    expect(skipped).toBe(file)

    const rotated = await rotateImage(file, 1)
    expect(rotated).not.toBe(file)
    expect(rotated.type).toBe('image/jpeg')
  })

  it('re-encodes at zero turns too, so the preview matches what is stored', async () => {
    const file = jpeg()
    expect(await rotateImage(file, 0)).not.toBe(file)
  })

  it('refuses an empty file with a message the upload UI can show', async () => {
    const empty = new File([], 'photo.jpg', { type: 'image/jpeg' })
    await expect(rotateImage(empty, 1)).rejects.toBeInstanceOf(ImageUploadError)
  })

  it('throws rather than returning the unturned original when decoding fails', async () => {
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('no decoder') })
    vi.stubGlobal('document', { createElement: () => ({ set src(_v: string) { queueMicrotask(() => (this as { onerror?: () => void }).onerror?.()) } }) })
    await expect(rotateImage(jpeg(), 1)).rejects.toBeInstanceOf(ImageUploadError)
  })
})

describe('downscaleImage', () => {
  it('still shortcuts a small JPEG, leaving its EXIF for the server to act on', async () => {
    stubBrowser(1200, 900)
    const file = jpeg()
    expect(await downscaleImage(file)).toBe(file)
  })

  it('re-encodes when the long edge is over the cap', async () => {
    stubBrowser(4000, 3000)
    const file = jpeg()
    const out = await downscaleImage(file, 1600)
    expect(out).not.toBe(file)
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
  })
})
