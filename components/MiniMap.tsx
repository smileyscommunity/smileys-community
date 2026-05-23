'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

interface Props {
  lat:   number
  lng:   number
  href?: string
}

export default function MiniMap({ lat, lng, href }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    async function init() {
      const L = await import('leaflet')

      const map = L.map(containerRef.current!, {
        center:            [lat, lng],
        zoom:              15,
        zoomControl:       false,
        attributionControl:false,
        dragging:          false,
        touchZoom:         false,
        doubleClickZoom:   false,
        scrollWheelZoom:   false,
        boxZoom:           false,
        keyboard:          false,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:22px;height:22px;
          background:#f59e0b;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          border:2.5px solid white;
          box-shadow:0 2px 8px rgba(0,0,0,0.35)
        "></div>`,
        iconSize:   [22, 22],
        iconAnchor: [11, 22],
      })

      L.marker([lat, lng], { icon }).addTo(map)

      mapRef.current = map
    }

    init()

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [lat, lng])

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ height: 148 }}>
      <div ref={containerRef} className="w-full h-full" />
      {/* Clickable overlay — opens in external maps */}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-10"
          aria-label="Open in maps"
        />
      )}
      {/* "Open in maps" badge */}
      <div className="absolute bottom-2 right-2 z-20 pointer-events-none">
        <span className="flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-semibold text-gray-700 shadow-sm border border-gray-100">
          <svg className="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open in maps
        </span>
      </div>
    </div>
  )
}
