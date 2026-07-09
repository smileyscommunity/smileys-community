'use client'

// eslint-disable-next-line @typescript-eslint/no-require-imports
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { Event } from '@/lib/data'

const ISTANBUL = { lat: 41.0082, lng: 28.9784 }

interface Props {
  events: Event[]
  selectedId: string | null
  onSelect: (id: string) => void
  attendance: Record<string, 'joined' | 'pending' | 'waitlisted'>
}

interface HoveredPin {
  event: Event
  x: number
  y: number
}

export default function EventMap({ events, selectedId, onSelect, attendance }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<any>(null)
  const markersRef   = useRef<any[]>([])
  const [hovered, setHovered] = useState<HoveredPin | null>(null)
  const [ready, setReady]     = useState(false)

  const mappable = events.filter(e => e.lat != null && e.lng != null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let L: any
    let map: any

    async function init() {
      L = await import('leaflet')

      map = L.map(containerRef.current!, {
        center: [ISTANBUL.lat, ISTANBUL.lng],
        zoom: 12,
        zoomControl: true,
        attributionControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      mapRef.current = map

      // Fit to event bounds if we have pins
      if (mappable.length > 0) {
        const bounds = L.latLngBounds(mappable.map(e => [e.lat!, e.lng!]))
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 })
      }

      setReady(true)
    }

    init()

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Sync markers when events or selected changes
  useEffect(() => {
    if (!ready || !mapRef.current) return

    async function syncMarkers() {
      const L = (await import('leaflet')).default ?? (await import('leaflet'))
      const map = mapRef.current

      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      mappable.forEach(event => {
        const isSelected = event.id === selectedId
        const status     = attendance[event.id]

        const color = isSelected ? '#d97706' : '#f59e0b'
        const size  = isSelected ? 32 : 26
        const ring  = isSelected ? 'ring-2 ring-offset-1 ring-amber-700' : ''

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:${size}px;height:${size}px;
            background:${color};
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            border:2px solid white;
            box-shadow:0 2px 6px rgba(0,0,0,0.35);
            cursor:pointer;
          "></div>`,
          iconSize:   [size, size],
          iconAnchor: [size / 2, size],
        })

        const marker = L.marker([event.lat!, event.lng!], { icon })
          .addTo(map)
          .on('click', () => onSelect(event.id))
          .on('mouseover', (e: any) => {
            const containerRect = containerRef.current!.getBoundingClientRect()
            const pt = map.latLngToContainerPoint([event.lat!, event.lng!])
            setHovered({
              event,
              x: pt.x,
              y: pt.y,
            })
          })
          .on('mouseout', () => setHovered(null))

        markersRef.current.push(marker)
      })
    }

    syncMarkers()
  }, [ready, mappable.length, selectedId, attendance])

  // Pan to selected event
  useEffect(() => {
    if (!ready || !mapRef.current || !selectedId) return
    const event = mappable.find(e => e.id === selectedId)
    if (event?.lat && event?.lng) {
      mapRef.current.panTo([event.lat, event.lng], { animate: true, duration: 0.4 })
    }
  }, [selectedId, ready])

  const noCoords = events.length > 0 && mappable.length === 0

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full overflow-hidden z-0" />

      {noCoords && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50/90 z-10 pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-2">📍</div>
            <p className="text-gray-600 font-medium text-sm">No events have coordinates yet.</p>
            <p className="text-gray-400 text-xs mt-1">Admins can add lat/lng when creating events.</p>
          </div>
        </div>
      )}

      {mappable.length < events.length && mappable.length > 0 && (
        <div className="absolute top-3 right-3 z-10 bg-white/90 backdrop-blur-sm text-xs text-gray-600 px-2.5 py-1.5 rounded-lg shadow-sm border border-gray-200">
          {mappable.length} of {events.length} events have locations
        </div>
      )}

      {hovered && (
        <MiniCard
          event={hovered.event}
          x={hovered.x}
          y={hovered.y}
          status={attendance[hovered.event.id] ?? null}
        />
      )}
    </div>
  )
}

function MiniCard({ event, x, y, status }: { event: Event; x: number; y: number; status: 'joined' | 'pending' | 'waitlisted' | null }) {
  const fmt = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  // Position card above the pin, clamped so it doesn't overflow
  const CARD_W = 240
  const CARD_H = 130

  let left = x - CARD_W / 2
  let top  = y - CARD_H - 16

  // Don't let it go negative
  if (left < 8) left = 8
  if (top  < 8) top  = 8

  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{ left, top, width: CARD_W }}
    >
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
        {event.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverImage} alt="" className="w-full h-20 object-cover" />
        )}
        <div className="p-2.5">
          <p className="text-xs font-bold text-gray-900 line-clamp-1">{event.emoji} {event.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{fmt(event.date)} · {event.neighborhood}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs font-semibold text-amber-600">
              {event.price === 0 ? 'Free' : `${event.price} ${event.currency ?? 'TRY'}`}
            </span>
            {status === 'joined' && (
              <span className="text-xs font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">Joined</span>
            )}
            {status === 'pending' && (
              <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Pending</span>
            )}
          </div>
        </div>
      </div>
      {/* Arrow */}
      <div className="flex justify-center">
        <div className="w-3 h-3 bg-white border-r border-b border-gray-200 rotate-45 -mt-1.5 shadow-sm" />
      </div>
    </div>
  )
}
