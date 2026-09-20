'use client'

import { useEffect, useRef } from 'react'
import QRCodeLib from 'qrcode'

interface Props {
  value: string
  /** CSS size in px. The canvas itself is drawn denser — see below. */
  size?:  number
  /** What a screen reader says. It's a picture of a code, so it needs words. */
  label?: string
  className?: string
}

// A QR code is only as good as its smallest module. The canvas used to be
// drawn at exactly its CSS size, so on a phone at 3× every module was blurred
// across a third of a device pixel — at the 84px the member card used, each
// module was about a third of a millimetre of smeared grey, which is why a
// card sometimes took three tries at the door. Drawing at size × dpr and
// letting CSS scale it back down gives the scanner crisp edges.
const MAX_DPR = 3

export default function QRCode({ value, size = 220, label = 'QR code', className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR)
    QRCodeLib.toCanvas(canvas, value, {
      width: Math.round(size * dpr),
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {})
    // toCanvas resizes the element to the drawn pixels, so the CSS size has
    // to be restored after it — otherwise the code renders dpr times too big.
    // This runs after because qrcode draws synchronously inside the Promise
    // executor: the resize has already happened by the time the call returns.
    canvas.style.width  = `${size}px`
    canvas.style.height = `${size}px`
  }, [value, size])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className={`rounded-xl ${className}`}
    />
  )
}
