'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Map } from 'leaflet'

export interface MapPoint {
  name:        string
  slug:        string
  lat:         number
  lon:         number
  memberCount: number
  eventCount:  number
}

// Neighborhood-level markers ONLY. Every coordinate here comes from
// NEIGHBORHOOD_META — a fixed centre point per neighborhood — never from a
// member record. No member position is plotted, derived or approximated,
// which is the whole reason this takes MapPoint rather than a user list:
// there is no shape of data reaching this component that could leak one.
export default function NeighborhoodsMapView({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    import('leaflet').then(L => {
      if (!containerRef.current || mapRef.current) return

      // Marker icon paths break under webpack asset hashing; point them at
      // the CDN copies the rest of the app's maps already use.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current).setView([41.02, 28.98], 11)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map)

      const group: L.Marker[] = []
      for (const p of points) {
        const marker = L.marker([p.lat, p.lon]).addTo(map)
        // Popup content is escaped by Leaflet's text handling only if we pass
        // a DOM node, so build one instead of concatenating HTML with a
        // neighborhood name in it.
        const el = document.createElement('div')
        const title = document.createElement('p')
        title.className = 'font-bold text-gray-900 text-sm'
        title.textContent = p.name
        const stats = document.createElement('p')
        stats.className = 'text-xs text-gray-600 mt-0.5'
        stats.textContent = `${p.memberCount} Smileys · ${p.eventCount} upcoming`
        const link = document.createElement('a')
        link.href = `/app/neighborhoods/${p.slug}`
        link.className = 'text-xs font-bold text-amber-600'
        link.textContent = `Explore ${p.name} →`
        el.append(title, stats, link)
        marker.bindPopup(el)
        group.push(marker)
      }
      if (group.length > 0) {
        map.fitBounds(L.featureGroup(group).getBounds().pad(0.15))
      }
    })

    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [points])

  return <div ref={containerRef} className="w-full h-[420px] sm:h-[520px] rounded-2xl overflow-hidden z-0" />
}
