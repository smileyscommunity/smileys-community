'use client'

interface Props {
  eventDates: string[] // 'YYYY-MM-DD'
}

const DAYS   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function MiniCalendar({ eventDates }: Props) {
  const now      = new Date()
  const year     = now.getFullYear()
  const month    = now.getMonth()
  const todayStr = now.toISOString().split('T')[0]

  const firstDay  = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const eventSet = new Set(eventDates)

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-900">{MONTHS[month]} {year}</span>
        <Link href="/my-events" className="text-xs text-amber-600 font-semibold hover:underline">My events →</Link>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAYS.map(d => (
          <div key={d} className="text-xs font-bold text-gray-400 py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateStr === todayStr
          const hasEvent = eventSet.has(dateStr)
          return (
            <div key={i} className="relative flex flex-col items-center py-0.5">
              <span className={`text-xs w-7 h-7 flex items-center justify-center rounded-full font-medium transition-colors ${
                isToday ? 'bg-amber-500 text-white font-bold' : 'text-gray-700 hover:bg-gray-100'
              }`}>
                {day}
              </span>
              {hasEvent && !isToday && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-amber-400 rounded-full" />
              )}
              {hasEvent && isToday && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Import inside component file to keep it a client component
import Link from 'next/link'
