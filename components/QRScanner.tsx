'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan:  (value: string) => void
  onClose: () => void
}

// Reads one QR value from the camera, with whichever engine the browser has:
//   - BarcodeDetector (Chrome, Android): native and fast.
//   - jsQR on canvas frames everywhere else. iOS Safari has no
//     BarcodeDetector, so every host at the door with an iPhone used to get
//     "QR scanning not supported" and a list to scroll. Loaded only when
//     needed, so a browser with the native detector never downloads it.

type Detect = (video: HTMLVideoElement) => Promise<string | null>

// jsQR decodes on the main thread: ten reads a second is plenty for a card
// held up to the camera, and leaves the phone its battery.
const FALLBACK_INTERVAL_MS = 100
// A member card fills the window; a downscaled frame reads just as well and
// costs a phone a fraction of the time of a full 1080p one.
const FALLBACK_MAX_WIDTH = 640

async function createDetector(): Promise<Detect> {
  if ('BarcodeDetector' in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
    return async video => {
      const codes: { rawValue: string }[] = await detector.detect(video)
      return codes[0]?.rawValue ?? null
    }
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const ctx    = canvas.getContext('2d', { willReadFrequently: true })
  let last = 0
  return async video => {
    const now = performance.now()
    if (!ctx || !video.videoWidth || now - last < FALLBACK_INTERVAL_MS) return null
    last = now
    const scale  = Math.min(1, FALLBACK_MAX_WIDTH / video.videoWidth)
    const width  = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    if (canvas.width !== width)   canvas.width  = width
    if (canvas.height !== height) canvas.height = height
    ctx.drawImage(video, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)
    return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data || null
  }
}

export default function QRScanner({ onScan, onClose }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const stopRef    = useRef<() => void>(() => {})
  // Latest onScan without restarting the camera when the parent re-renders
  // with a new callback identity.
  const onScanRef  = useRef(onScan)
  onScanRef.current = onScan
  const [error, setError]           = useState('')
  const [supported, setSupported]   = useState(true)

  useEffect(() => {
    // No camera API at all: an insecure (http) page or a very old browser.
    if (!navigator.mediaDevices?.getUserMedia) { setSupported(false); return }

    // Per-run state, not a shared ref. The old activeRef was set false on
    // cleanup and never reset, and a getUserMedia promise that resolved AFTER
    // close stored its stream where no cleanup would ever see it — the camera
    // light stayed on with the scanner gone.
    let active = true
    let stream: MediaStream | null = null
    let frame  = 0

    function stop() {
      active = false
      if (frame) cancelAnimationFrame(frame)
      stream?.getTracks().forEach(t => t.stop())
      stream = null
      const video = videoRef.current
      if (video) video.srcObject = null
    }
    stopRef.current = stop

    createDetector()
      .then(detect => {
        if (!active) return
        return navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          .then(s => {
            // Closed while the permission prompt / camera start-up was pending.
            if (!active) { s.getTracks().forEach(t => t.stop()); return }
            stream = s
            const video = videoRef.current
            if (!video) { stop(); return }
            video.srcObject = s
            video.play().catch(() => {})

            async function scan() {
              if (!active || !videoRef.current) return
              try {
                const value = await detect(videoRef.current)
                if (value && active) {
                  // Camera off as soon as a code is read, whatever the parent does next.
                  stop()
                  onScanRef.current(value)
                  return
                }
              } catch {}
              if (active) frame = requestAnimationFrame(scan)
            }

            video.addEventListener('playing', () => { if (active) frame = requestAnimationFrame(scan) }, { once: true })
          })
          .catch(() => { if (active) setError('Camera access denied — please allow camera permissions and try again.') })
      })
      .catch(() => { if (active) setError("The scanner couldn't start — check in from the list instead.") })

    return stop
  }, [])

  // Every close path releases the camera first, not only the unmount.
  function close() {
    stopRef.current()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <p className="text-white font-semibold text-base">Scan member QR</p>
        <button onClick={close} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white text-lg hover:bg-white/20 transition-colors">
          ✕
        </button>
      </div>

      {!supported ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white text-center px-8 gap-4">
          <div className="text-5xl">📷</div>
          <p className="font-semibold">Camera not available</p>
          <p className="text-sm text-white/60">This browser can&apos;t open the camera here. Check people in from the list instead.</p>
          <button onClick={close} className="mt-2 px-6 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold">Go back</button>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
          <div className="text-5xl">🚫</div>
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={close} className="mt-2 px-6 py-2.5 bg-zinc-700 text-white rounded-xl text-sm font-semibold">Go back</button>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />

          {/* Dimmed overlay with cutout effect */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative w-60 h-60">
              {/* Clear window */}
              <div className="absolute inset-0 bg-transparent rounded-2xl" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-amber-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-amber-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-amber-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-amber-400 rounded-br-xl" />
            </div>
          </div>

          <p className="absolute bottom-10 left-0 right-0 text-center text-white/70 text-sm z-10">
            Point at the member's QR code
          </p>
        </div>
      )}
    </div>
  )
}
