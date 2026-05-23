'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Map } from 'leaflet'

interface Props {
  lat: number
  lon: number
  name: string
}

export default function NeighborhoodMap({ lat, lon, name }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    import('leaflet').then(L => {
      if (!containerRef.current || mapRef.current) return

      // Fix marker icon paths broken by webpack asset hashing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current, {
        center:          [lat, lon],
        zoom:            14,
        zoomControl:     true,
        scrollWheelZoom: false,
        dragging:        true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      L.marker([lat, lon]).addTo(map).bindPopup(name)

      mapRef.current = map
      // Force recalculate size after paint in case container wasn't measured yet
      requestAnimationFrame(() => map.invalidateSize())
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [lat, lon, name])

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />
}
