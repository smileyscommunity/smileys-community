'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { LayerGroup, Map, Marker } from 'leaflet'

export interface MapPoint {
  name:        string
  slug:        string
  lat:         number
  lon:         number
  memberCount: number
  eventCount:  number
}

const FALLBACK_CENTER: [number, number] = [41.02, 28.98]

// Neighborhood-level markers ONLY. Every coordinate here comes from
// NEIGHBORHOOD_META — a fixed centre point per neighborhood — never from a
// member record. No member position is plotted, derived or approximated,
// which is the whole reason this takes MapPoint rather than a user list:
// there is no shape of data reaching this component that could leak one.
//
// `center` (the viewed city's centre) decides where a pointless map opens;
// without it — or for a city missing coordinates — the Istanbul default
// below stands. Pins always win: fitBounds overrides the initial view.
export default function NeighborhoodsMapView({ points, center, cityQuery = '' }: { points: MapPoint[]; center?: [number, number] | null; cityQuery?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<Map | null>(null)
  const leafletRef   = useRef<typeof import('leaflet') | null>(null)
  const layerRef     = useRef<LayerGroup | null>(null)
  // The city the current view was framed for; null = not framed yet.
  const framedFor    = useRef<string | null>(null)
  // Bumped when a map instance is ready, so the marker effect runs against it.
  const [mapGen, setMapGen] = useState(0)

  // The map used to be built in one effect keyed on [points, center]. The
  // parent rebuilds `points` as a fresh array on every render — every
  // keystroke in the neighborhood search — so each one tore the map down,
  // re-created it and re-ran fitBounds, throwing away the member's pan/zoom.
  // Now the instance is created once, markers are redrawn only when their
  // content changes, and the view is framed only on first draw or a new city.
  const pointsKey = points.map(p => `${p.slug}:${p.lat}:${p.lon}:${p.memberCount}:${p.eventCount}`).join('|')
  const centerKey = center ? center.join(',') : ''
  const latest = useRef({ points, center })
  latest.current = { points, center }

  useEffect(() => {
    let disposed = false

    import('leaflet').then(L => {
      if (disposed || !containerRef.current || mapRef.current) return

      // Marker icon paths break under webpack asset hashing; point them at
      // our own copies in public/leaflet. They used to come from unpkg, which
      // meant every map on the site told a third party who was looking at it
      // — and rendered markerless the day that CDN was slow.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: '/app/leaflet/marker-icon-2x.png',
        iconUrl:       '/app/leaflet/marker-icon.png',
        shadowUrl:     '/app/leaflet/marker-shadow.png',
      })

      const map = L.map(containerRef.current).setView(latest.current.center ?? FALLBACK_CENTER, 11)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map)

      leafletRef.current = L
      mapRef.current     = map
      layerRef.current   = L.layerGroup().addTo(map)
      setMapGen(g => g + 1)
    })

    return () => {
      disposed = true
      mapRef.current?.remove()
      mapRef.current   = null
      layerRef.current = null
      framedFor.current = null
    }
  }, [])

  useEffect(() => {
    const L = leafletRef.current, map = mapRef.current, layer = layerRef.current
    if (!L || !map || !layer) return
    const { points: pts, center: ctr } = latest.current

    layer.clearLayers()
    const markers: Marker[] = []
    for (const p of pts) {
      const marker = L.marker([p.lat, p.lon])
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
      link.href = `/app/neighborhoods/${p.slug}${cityQuery}`
      link.className = 'text-xs font-bold text-amber-600'
      link.textContent = `Explore ${p.name} →`
      el.append(title, stats, link)
      marker.bindPopup(el)
      layer.addLayer(marker)
      markers.push(marker)
    }

    // Frame only on the first draw and when the city changes — a side-chip
    // filter redraws markers but leaves the member's pan/zoom alone.
    if (framedFor.current !== centerKey) {
      framedFor.current = centerKey
      if (markers.length > 0) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15))
      else map.setView(ctr ?? FALLBACK_CENTER, 11)
    }
  }, [mapGen, pointsKey, centerKey, cityQuery])

  return <div ref={containerRef} className="w-full h-[420px] sm:h-[520px] rounded-2xl overflow-hidden z-0" />
}
