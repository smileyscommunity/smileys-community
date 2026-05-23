'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan:  (value: string) => void
  onClose: () => void
}

export default function QRScanner({ onScan, onClose }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const activeRef  = useRef(true)
  const [error, setError]           = useState('')
  const [supported, setSupported]   = useState(true)

  useEffect(() => {
    if (!('BarcodeDetector' in window)) { setSupported(false); return }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.play()

        async function scan() {
          if (!activeRef.current || !videoRef.current) return
          try {
            const codes: { rawValue: string }[] = await detector.detect(videoRef.current)
            if (codes.length > 0 && activeRef.current) {
              activeRef.current = false
              onScan(codes[0].rawValue)
              return
            }
          } catch {}
          if (activeRef.current) requestAnimationFrame(scan)
        }

        video.addEventListener('playing', () => { if (activeRef.current) requestAnimationFrame(scan) }, { once: true })
      })
      .catch(() => setError('Camera access denied — please allow camera permissions and try again.'))

    return () => {
      activeRef.current = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <p className="text-white font-semibold text-base">Scan member QR</p>
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white text-lg hover:bg-white/20 transition-colors">
          ✕
        </button>
      </div>

      {!supported ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white text-center px-8 gap-4">
          <div className="text-5xl">📷</div>
          <p className="font-semibold">QR scanning not supported</p>
          <p className="text-sm text-white/60">Update Chrome or Safari to the latest version, or check in manually from the list below.</p>
          <button onClick={onClose} className="mt-2 px-6 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold">Go back</button>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
          <div className="text-5xl">🚫</div>
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={onClose} className="mt-2 px-6 py-2.5 bg-zinc-700 text-white rounded-xl text-sm font-semibold">Go back</button>
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
