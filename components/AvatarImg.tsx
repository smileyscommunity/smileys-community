'use client'
import { useState } from 'react'

interface Props {
  src: string
  name: string
  color: string
  size?: string          // tailwind w/h class e.g. "w-12 h-12"
  textSize?: string      // tailwind text class e.g. "text-sm"
  className?: string     // extra classes on the img/div
}

// Renders a profile photo with an automatic initials fallback if the
// image fails to load (403 from applications-folder gate, 404 if the
// file was deleted, or a sharp processing error on the server).
export default function AvatarImg({ src, name, color, size = 'w-12 h-12', textSize = 'text-sm', className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  if (failed) {
    return (
      <div
        className={`${size} rounded-full border-2 border-white shadow-sm flex items-center justify-center text-white font-bold ${textSize} ${className}`}
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${size} rounded-full object-cover border-2 border-white shadow-sm ${className}`}
    />
  )
}
