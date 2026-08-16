'use client'

import { useState, useEffect } from 'react'

interface Weather {
  temp: number | null
  text: string
  icon: string
}

const CODE_MAP: Record<number, { text: string; icon: string }> = {
  0:  { text: 'Clear sky',      icon: '☀️' },
  1:  { text: 'Mainly clear',   icon: '🌤️' },
  2:  { text: 'Partly cloudy',  icon: '⛅' },
  3:  { text: 'Overcast',       icon: '☁️' },
  45: { text: 'Foggy',          icon: '🌫️' },
  48: { text: 'Icy fog',        icon: '🌫️' },
  51: { text: 'Light drizzle',  icon: '🌦️' },
  53: { text: 'Drizzle',        icon: '🌦️' },
  55: { text: 'Heavy drizzle',  icon: '🌧️' },
  61: { text: 'Light rain',     icon: '🌧️' },
  63: { text: 'Rain',           icon: '🌧️' },
  65: { text: 'Heavy rain',     icon: '🌧️' },
  71: { text: 'Light snow',     icon: '❄️' },
  73: { text: 'Snow',           icon: '❄️' },
  75: { text: 'Heavy snow',     icon: '❄️' },
  80: { text: 'Rain showers',   icon: '🌦️' },
  95: { text: 'Thunderstorm',   icon: '⛈️' },
}

// Weather for the city you're actually in.
//
// This was hard-coded to Istanbul's coordinates and timezone, so a member in
// Izmir or Bodrum saw Istanbul's weather with their own city implied. The
// coordinates now come from the City row (lat/lng), resolved the same way every
// other city-scoped surface is.
//
// Renders nothing when a city has no coordinates yet: a weather card showing
// somewhere else's sky is worse than no card.
export default function CityWeather({
  name,
  lat,
  lng,
  timezone = 'Europe/Istanbul',
}: {
  name: string
  lat?: number | null
  lng?: number | null
  timezone?: string
}) {
  const [weather, setWeather] = useState<Weather | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (lat == null || lng == null) { setLoading(false); return }
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&timezone=${encodeURIComponent(timezone)}`)
      .then(r => r.json())
      .then(d => {
        const code = d.current_weather?.weathercode ?? 0
        const map  = CODE_MAP[code] ?? { text: 'Clear', icon: '☀️' }
        setWeather({ temp: Math.round(d.current_weather.temperature), ...map })
      })
      .catch(() => {
        setWeather({ temp: null, text: name, icon: '🌤️' })
      })
      .finally(() => setLoading(false))
  }, [lat, lng, timezone, name])

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-4 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-2.5 w-16 bg-white/30 rounded-full" />
            <div className="h-6 w-20 bg-white/30 rounded-full" />
          </div>
          <div className="w-10 h-10 bg-white/30 rounded-full" />
        </div>
      </div>
    )
  }

  if (!weather) return null

  // hourCycle:'h23', never hour12:false — the latter renders midnight as
  // "24:MM" on the server's ICU build.
  const now = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone,
  })

  return (
    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-card p-4 text-white">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{name} · {now}</p>
          <div className="flex items-end gap-1.5 mt-1">
            {weather.temp !== null && (
              <span className="text-3xl font-black leading-none">{weather.temp}°</span>
            )}
            <span className="text-xs font-semibold pb-0.5 opacity-90">{weather.text}</span>
          </div>
        </div>
        <span className="text-4xl">{weather.icon}</span>
      </div>
    </div>
  )
}
