import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'

// Current conditions for the city the caller is scoped to.
//
// Exists because the hangouts feed is a client component with no city context:
// it was fetching open-meteo directly with Istanbul's coordinates baked into
// the URL, so an Izmir member saw Istanbul's sky beside a hangout down their
// own road. Resolving the city server-side means the client never holds
// coordinates at all, and the answer follows the city switcher for free.
//
// Returns null weather (not an error) when a city has no coordinates yet —
// callers render nothing rather than somewhere else's weather.

export const runtime = 'nodejs'

const ICONS: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌦️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const city = await prisma.city.findUnique({
    where:  { id: await resolveCityId(session) },
    select: { name: true, lat: true, lng: true, timezone: true },
  })
  if (!city?.lat || !city?.lng) return NextResponse.json({ weather: null })

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}`
      + `&current_weather=true&timezone=${encodeURIComponent(city.timezone)}`
    // Short revalidate: conditions move slowly, and this is one upstream call
    // shared by every member in the city rather than one per browser.
    const res = await fetch(url, { next: { revalidate: 600 } })
    if (!res.ok) return NextResponse.json({ weather: null })
    const d = await res.json()
    const c = d?.current_weather
    if (!c) return NextResponse.json({ weather: null })
    return NextResponse.json({
      weather: { temp: Math.round(c.temperature), icon: ICONS[c.weathercode] ?? '🌤️', city: city.name },
    })
  } catch {
    // A weather widget must never break the page it sits on.
    return NextResponse.json({ weather: null })
  }
}
