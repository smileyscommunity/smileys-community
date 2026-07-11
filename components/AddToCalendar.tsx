'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  title: string
  date: string
  time: string
  /** Explicit end (YYYY-MM-DD + HH:MM). If omitted, defaults to start + 2h. */
  endDate?: string
  endTime?: string
  location?: string
  description?: string
  url: string
  compact?: boolean
}

function pad(n: number) { return String(n).padStart(2, '0') }

function toICSDate(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min]  = time.split(':').map(Number)
  return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`
}

function toICSDateEnd(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min]  = time.split(':').map(Number)
  const end = new Date(y, m - 1, d, h + 2, min)
  return `${end.getFullYear()}${pad(end.getMonth()+1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`
}

export default function AddToCalendar({ title, date, time, endDate, endTime, location, description, url, compact }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const start   = toICSDate(date, time)
  // Use the real end when given (hangouts); otherwise default to +2h (events).
  const end     = endDate && endTime ? toICSDate(endDate, endTime) : toICSDateEnd(date, time)
  const encoded = encodeURIComponent

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encoded(title)}` +
    `&dates=${start}/${end}` +
    `&location=${encoded(location ?? '')}` +
    `&details=${encoded((description ?? '') + '\n\n' + url)}`

  function downloadICS() {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Smileys Community//EN',
      'BEGIN:VEVENT',
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${title}`,
      `LOCATION:${location ?? ''}`,
      `DESCRIPTION:${(description ?? '').replace(/\n/g, '\\n')} ${url}`,
      `URL:${url}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const blob = new Blob([ics], { type: 'text/calendar' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={compact
          ? "p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-600"
          : "flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 text-sm font-semibold transition-colors"
        }
        aria-label="Add to calendar"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {!compact && <span>Add to calendar</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl z-20 py-1.5 min-w-[180px]">
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.5 3h-2.25V1.5h-1.5V3h-7.5V1.5h-1.5V3H4.5A1.5 1.5 0 003 4.5v15A1.5 1.5 0 004.5 21h15a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0019.5 3zm0 16.5h-15V9h15v10.5zM6 10.5h5.25V15H6z" />
            </svg>
            Google Calendar
          </a>
          <button
            onClick={downloadICS}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Apple / Outlook (.ics)
          </button>
        </div>
      )}
    </div>
  )
}
