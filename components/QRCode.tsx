'use client'

import { useEffect, useRef } from 'react'
import QRCodeLib from 'qrcode'

interface Props {
  value: string
  size?: number
}

export default function QRCode({ value, size = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {})
  }, [value, size])

  return <canvas ref={canvasRef} width={size} height={size} className="rounded-xl" />
}
