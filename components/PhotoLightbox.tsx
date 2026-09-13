'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveImageUrl } from '@/lib/data'
import { getInitials } from '@/lib/data'

export interface LightboxPhoto {
  url: string
  caption?: string | null
  /** Optional credit line under the image. Omit where the surface already shows it. */
  by?: { name: string; color: string; photo?: string | null } | null
}

/**
 * Full-size view for a posted photo, shared by every surface that shows one.
 *
 * It was written once for event photos and nowhere else, so a photo on a
 * neighbourhood wall post or in a club gallery was a dead `<img>` — and on the
 * wall `object-cover` crops it, meaning part of the picture had no way of
 * being seen at all.
 *
 * The portal is the load-bearing detail, not tidiness: rendering to
 * document.body escapes any ancestor carrying `backdrop-filter` or
 * `transform`, which would otherwise become the containing block for
 * `position: fixed` and trap the overlay inside the card it came from. The
 * mount gate keeps that off the server render.
 */
export default function PhotoLightbox({ photo, onClose }: { photo: LightboxPhoto | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Escape closes it. A full-screen overlay whose only exit is a tap in the
  // right place is a trap on a keyboard.
  useEffect(() => {
    if (!photo) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photo, onClose])

  if (!photo || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      style={{ zIndex: 9999 }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button aria-label="Close" className="absolute top-4 right-4 w-10 h-10 bg-black/50 hover:bg-black/80 rounded-full flex items-center justify-center text-white text-lg transition-colors">✕</button>
      <img
        src={resolveImageUrl(photo.url)}
        alt={photo.caption ?? ''}
        className="max-w-full max-h-[80vh] rounded-xl object-contain"
        onClick={e => e.stopPropagation()}
      />
      {(photo.by || photo.caption) && (
        <div className="mt-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {photo.by && (
            <>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: photo.by.color }}>
                {photo.by.photo
                  ? <img src={resolveImageUrl(photo.by.photo)} alt="" className="w-full h-full rounded-full object-cover" />
                  : getInitials(photo.by.name)}
              </div>
              <span className="text-white/80 text-sm">{photo.by.name}</span>
            </>
          )}
          {photo.caption && <span className="text-white/50 text-sm">{photo.by ? '· ' : ''}{photo.caption}</span>}
        </div>
      )}
    </div>,
    document.body,
  )
}
