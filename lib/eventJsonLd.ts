// ItemList-of-Event structured data for the event LISTING pages.
//
// Individual events have carried full Event JSON-LD for a long time
// (app/events/[id]/page.tsx), but no listing did: the global /events is
// client-rendered, so a crawler sees an empty shell, and the server-rendered
// /[city]/events hubs — built precisely to be the crawlable layer — emitted
// only Organization and City. So Google had every event page and no event
// list, which is what an event carousel is built from.
//
// Pure: takes rows and city facts, returns the object. The callers own the
// fetching and the <script> tag.

export interface JsonLdEvent {
  id:           string
  title:        string
  emoji:        string | null
  date:         string          // 'YYYY-MM-DD'
  time?:        string | null   // 'HH:MM', may be absent or 'TBA'
  location?:    string | null
  neighborhood?: string | null
  description?: string | null
  coverImage?:  string | null
}

export interface JsonLdCity {
  name:     string
  country:  string
  timezone: string
}

/**
 * The city's UTC offset on that date, as "+03:00".
 *
 * Not a literal: every Smileys city shares Türkiye's clock today, so a pinned
 * +03:00 would be right everywhere and wrong the moment a city outside it goes
 * live — the failure tests/timezoneHardcoding exists to prevent. Computed per
 * event date so a listing spanning a DST change is right on both sides of it.
 */
export function offsetInTz(date: Date, timezone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(date).find(p => p.type === 'timeZoneName')?.value ?? ''
    // "GMT+03:00", and plain "GMT" at UTC itself.
    const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/)
    if (!m) return 'Z'
    return `${m[1]}${m[2]}:${m[3] ?? '00'}`
  } catch {
    return 'Z'   // an unknown zone must not take the page down
  }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)/

/**
 * schema.org startDate. Events store `date` and `time` separately, and `time`
 * is member-entered — "TBA" is a real value in this data. An unparseable time
 * yields a date-only startDate, which schema.org allows, rather than a
 * fabricated midnight that would advertise the wrong hour.
 */
export function eventStartDate(e: JsonLdEvent, timezone: string): string {
  const m = e.time ? HHMM.exec(e.time) : null
  if (!m) return e.date
  const at = new Date(`${e.date}T${m[1]}:${m[2]}:00Z`)
  return `${e.date}T${m[1]}:${m[2]}:00${offsetInTz(at, timezone)}`
}

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export const MAX_LISTED = 20

/**
 * The list, or null when there is nothing to list — an empty ItemList is worse
 * than none: it tells a crawler the page has no events rather than staying quiet.
 */
export function eventListJsonLd(
  events: JsonLdEvent[],
  city: JsonLdCity,
  urls: { appUrl: string; siteUrl: string; absoluteImage?: (src: string | null | undefined) => string | undefined },
) {
  if (events.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: events.slice(0, MAX_LISTED).map((e, i) => {
      const image = urls.absoluteImage?.(e.coverImage)
      return {
        '@type':   'ListItem',
        position:  i + 1,
        item: {
          '@type':     'Event',
          name:        e.title,
          description: e.description
            ? plain(e.description).slice(0, 500)
            : `${e.emoji ?? '📅'} ${e.title} in ${e.neighborhood ?? city.name}, ${city.name}`,
          startDate:   eventStartDate(e, city.timezone),
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          location: {
            '@type': 'Place',
            name:    e.location || e.neighborhood || city.name,
            address: { '@type': 'PostalAddress', addressLocality: city.name, addressCountry: city.country },
          },
          ...(image ? { image } : {}),
          url:       `${urls.appUrl}/events/${e.id}`,
          organizer: { '@type': 'Organization', name: 'Smileys Community', url: urls.siteUrl },
        },
      }
    }),
  }
}
