'use client'

// Leaflet map view for /directory. Renders one pin per visible
// business; where each pin lands (own coords, else the default city's
// neighborhood centroid) lives in lib/directoryMapPosition.
//
// Businesses with no coords and no usable fallback are skipped (the
// pre-list filter in the parent should already exclude them). The
// caller controls visibility — when the parent's filter list
// shrinks, this component animates the visible pins.

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { Map, Marker } from 'leaflet'
import { resolvePosition, type PositionedBusiness } from '@/lib/directoryMapPosition'

export interface MapBusiness extends PositionedBusiness {
  name: string
  category: string
  avgRating:   number | null
  reviewCount: number
}

interface Props {
  businesses:   MapBusiness[]
  onPinClick?:  (id: string) => void
  // Where the map opens when no pins are visible — the viewed city's centre.
  // Optional: without it (or with a city missing coordinates) the map falls
  // back to the Istanbul-wide default view below.
  defaultCenter?: [number, number] | null
}

// Istanbul-wide default view — centered between the European and
// Asian sides at a zoom where most central neighborhoods fit.
const DEFAULT_CENTER: [number, number] = [41.0245, 29.0083]
const DEFAULT_ZOOM = 11

export default function DirectoryMap({ businesses, onPinClick, defaultCenter }: Props) {
  const [ready, setReady] = useState(false)
  // citySlug is in the key because it decides whether a coordinate-less
  // business gets a neighborhood pin — a change must redraw.
  const pinKey = businesses.map(b => `${b.id}:${b.latitude}:${b.longitude}:${b.citySlug ?? ''}:${b.avgRating ?? ''}:${b.reviewCount ?? ''}`).join('|')
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
        iconUrl:       '/app/leaflet/marker-icon.png',
        iconRetinaUrl: '/app/leaflet/marker-icon-2x.png',
        shadowUrl:     '/app/leaflet/marker-shadow.png',
      })

      const map = L.map(containerRef.current, {
        center:          defaultCenter ?? DEFAULT_CENTER,
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

      setReady(true)
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
        map.setView(defaultCenter ?? DEFAULT_CENTER, DEFAULT_ZOOM)
      }
    })

    return () => { cancelled = true }
    // Keyed on CONTENT: the parent hands over a fresh array and a fresh
  // centre tuple every render, which removed and re-added every pin and
  // snapped the viewport back on each keystroke. `ready` covers the first
  // mount, where this used to run before the map existed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ready, pinKey, onPinClick, defaultCenter?.[0], defaultCenter?.[1]])

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
