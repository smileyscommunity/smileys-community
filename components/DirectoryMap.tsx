'use client'

// Leaflet map view for /directory. Renders one pin per visible
// business; pins land on:
//   1. The business's own (lat, lon) when set, otherwise
//   2. The centroid of its neighborhood (from NEIGHBORHOOD_META)
//      offset by a deterministic per-id jitter so multiple
//      businesses in the same neighborhood don't all stack on the
//      same pixel.
//
// Businesses with no neighborhood AND no coords are skipped (the
// pre-list filter in the parent should already exclude them). The
// caller controls visibility — when the parent's filter list
// shrinks, this component animates the visible pins.

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Map, Marker } from 'leaflet'
import { NEIGHBORHOOD_META } from '@/lib/neighborhoods'

export interface MapBusiness {
  id: string
  name: string
  category: string
  neighborhood: string | null
  latitude:  number | null
  longitude: number | null
  avgRating:   number | null
  reviewCount: number
}

interface Props {
  businesses:   MapBusiness[]
  onPinClick?:  (id: string) => void
}

// Deterministic per-id jitter in roughly ±300m at Istanbul's latitude.
// Same id always produces the same offset, so re-renders don't make
// pins jump around.
function jitterFromId(id: string): [number, number] {
  let a = 0, b = 0
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    a = (a * 131 + c)  & 0xffff
    b = (b * 257 + c) & 0xffff
  }
  // ~0.003 lat/lon at Istanbul lat ≈ 300m
  return [
    ((a / 0xffff) - 0.5) * 0.006,
    ((b / 0xffff) - 0.5) * 0.006,
  ]
}

function resolvePosition(b: MapBusiness): [number, number] | null {
  if (b.latitude != null && b.longitude != null) return [b.latitude, b.longitude]
  if (b.neighborhood) {
    const meta = NEIGHBORHOOD_META[b.neighborhood]
    if (meta) {
      const [dLat, dLon] = jitterFromId(b.id)
      return [meta.lat + dLat, meta.lon + dLon]
    }
  }
  return null
}

// Istanbul-wide default view — centered between the European and
// Asian sides at a zoom where most central neighborhoods fit.
const DEFAULT_CENTER: [number, number] = [41.0245, 29.0083]
const DEFAULT_ZOOM = 11

export default function DirectoryMap({ businesses, onPinClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<Map | null>(null)
  const markersRef   = useRef<Marker[]>([])

  // Init the map once. Cleanup tears it down on unmount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    import('leaflet').then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return
      // Fix marker icon paths broken by webpack asset hashing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current, {
        center:          DEFAULT_CENTER,
        zoom:            DEFAULT_ZOOM,
        zoomControl:     true,
        scrollWheelZoom: true,
        dragging:        true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map
      requestAnimationFrame(() => map.invalidateSize())
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markersRef.current = []
    }
  }, [])

  // Re-render pins whenever the business set changes (filter, search,
  // category, etc.). Pins are removed + re-added rather than diffed —
  // simpler and we're at <200 entries.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    import('leaflet').then(L => {
      if (cancelled || !mapRef.current) return
      // Clear existing
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      const bounds: [number, number][] = []
      for (const b of businesses) {
        const pos = resolvePosition(b)
        if (!pos) continue
        const marker = L.marker(pos).addTo(map)
        marker.bindPopup(
          `<div style="font-family: system-ui, sans-serif; min-width: 180px;">
            <div style="font-weight: 700; color: #111; margin-bottom: 2px;">${escapeHtml(b.name)}</div>
            <div style="font-size: 11px; color: #999;">${escapeHtml(b.category)}${b.neighborhood ? ' · ' + escapeHtml(b.neighborhood) : ''}</div>
            ${b.avgRating != null
              ? `<div style="font-size: 12px; margin-top: 4px;"><span style="color: #f59e0b;">★</span> <b>${b.avgRating.toFixed(1)}</b> <span style="color: #999;">· ${b.reviewCount} review${b.reviewCount === 1 ? '' : 's'}</span></div>`
              : '<div style="font-size: 11px; color: #aaa; margin-top: 4px;">No reviews yet</div>'}
            <button data-biz-id="${escapeHtml(b.id)}" class="dir-map-cta" style="
              margin-top: 8px; padding: 5px 10px;
              background: #f59e0b; color: white;
              font-size: 11px; font-weight: 700;
              border: none; border-radius: 6px;
              cursor: pointer; width: 100%;
            ">See details</button>
          </div>`,
          { closeButton: true, autoPan: true },
        )
        marker.on('popupopen', e => {
          const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>('.dir-map-cta')
          if (btn && onPinClick) {
            btn.addEventListener('click', () => onPinClick(b.id), { once: true })
          }
        })
        markersRef.current.push(marker)
        bounds.push(pos)
      }

      // Auto-fit to visible pins when the set is non-empty. With a
      // single pin we just center on it. With many, fit-bounds frames
      // them all with padding.
      if (bounds.length === 1) {
        map.setView(bounds[0], 14)
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
      } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
      }
    })

    return () => { cancelled = true }
  }, [businesses, onPinClick])

  return (
    <div className="relative w-full h-[60vh] sm:h-[70vh] rounded-2xl overflow-hidden border border-gray-200 bg-gray-100">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}

// Pop-up content is built as raw HTML (Leaflet's bindPopup takes a
// string). All interpolated user-supplied text passes through this
// escaper so a future business name containing "<script>" can't
// inject in the popup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
