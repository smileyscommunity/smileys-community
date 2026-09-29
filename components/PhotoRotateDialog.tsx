'use client'

import { useEffect, useRef, useState } from 'react'
import { rotateImage, ImageUploadError } from '@/lib/image-resize'

// The step between picking a profile photo and uploading it.
//
// Orientation is the one thing about an upload that no amount of server
// cleverness can always recover. A photo carrying an EXIF Orientation tag
// gets fixed automatically (sharp .rotate() on the upload route). A photo
// whose pixels are already sideways with NO tag — a screenshot, a WhatsApp
// forward, anything rotated in an app that rewrites pixels — looks correct
// to every check we can run, and lands wrong. The only reliable sensor for
// that is the member looking at it, so this shows them the photo exactly as
// it will be stored and gives them the turn.
//
// The preview is re-encoded on every turn rather than CSS-transformed, so
// what is on screen IS the file that uploads — a CSS rotation would look
// right and upload the unturned bytes. It re-encodes from the ORIGINAL file
// each time, never from the last preview, so spinning it round four times
// costs no quality.
export default function PhotoRotateDialog({
  file, busy = false, onCancel, onConfirm,
}: {
  file:      File
  busy?:     boolean
  onCancel:  () => void
  onConfirm: (rotated: File) => void
}) {
  const [turns,    setTurns]    = useState(0)
  const [prepared, setPrepared] = useState<File | null>(null)
  const [url,      setUrl]      = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  // Revoke on unmount only — the effect below hands each new URL over and
  // frees the one it replaces, so the <img> is never pointed at a revoked
  // blob (which renders as a broken image for a frame).
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  useEffect(() => {
    let cancelled = false
    setPrepared(null)
    ;(async () => {
      try {
        const rotated = await rotateImage(file, turns)
        if (cancelled) return
        const next = URL.createObjectURL(rotated)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = next
        setUrl(next)
        setPrepared(rotated)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof ImageUploadError ? e.message : "That photo couldn't be opened.")
      }
    })()
    return () => { cancelled = true }
  }, [file, turns])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  const working = !prepared && !error

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
         onClick={() => { if (!busy) onCancel() }}>
      <div role="dialog" aria-modal="true" aria-label="Check your photo"
           className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
           onClick={e => e.stopPropagation()}>

        <div className="px-5 pt-5 pb-3">
          <h2 className="font-bold text-lg text-gray-900">Is this the right way up?</h2>
          <p className="text-sm text-gray-500 mt-0.5">Turn it if you need to — this is exactly how it will look on your profile.</p>
        </div>

        <div className="mx-5 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden" style={{ height: '18rem' }}>
          {error
            ? <p className="text-sm text-red-600 px-6 text-center">{error}</p>
            : url
              ? <img src={url} alt="Your new profile photo" className={`max-h-full max-w-full object-contain transition-opacity ${working ? 'opacity-50' : 'opacity-100'}`} />
              : <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />}
        </div>

        <div className="flex items-center justify-center gap-2 px-5 pt-3">
          <button type="button" onClick={() => setTurns(t => t - 1)} disabled={working || busy || !!error}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h11a6 6 0 016 6v1" /></svg>
            Rotate left
          </button>
          <button type="button" onClick={() => setTurns(t => t + 1)} disabled={working || busy || !!error}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent">
            Rotate right
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H10a6 6 0 00-6 6v1" /></svg>
          </button>
        </div>

        <div className="flex gap-2 p-5 pt-4">
          <button type="button" onClick={onCancel} disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => prepared && onConfirm(prepared)} disabled={!prepared || busy || !!error}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {busy ? 'Uploading…' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>
  )
}
