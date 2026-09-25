// When the "Starting soon ⚡" reminder goes out (notification type
// reminder_2h — the name predates the change and stays, because the mute
// preference and the ⚡ icon are keyed on it).
//
// About six hours ahead, so a member still has time to plan the day around
// the event; it was two, which arrived as people were already on their way.
// The hourly sweep sends it on the first tick inside LEAD_HOURS.
//
// Never at night in the event's city: six hours before a 09:00 event is
// 03:00, and quiet hours only hold the push for members who switched them
// on. A reminder whose six-hour mark falls in the night waits for the first
// morning tick instead, as long as the event is still MIN_HOURS away — so a
// 10:00 event is reminded at 08:00, and an 08:30 one relies on the
// day-before reminder alone.

export const LEAD_HOURS = 6.5   // first hourly tick at or under this sends: 5.5–6.5h ahead
export const MIN_HOURS  = 1     // closer than this, the reminder is pointless
export const DAY_FROM   = 8     // local hour the sending window opens (inclusive)
export const DAY_TO     = 23    // local hour it closes (exclusive): nothing 23:00–07:59

/** The hour of day (0–23) in `timeZone` at `at`. h23, never hour12:false —
 *  that renders midnight as "24" on the server's ICU. */
export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at))
}

/** Whether this sweep tick should send the starting-soon reminder. */
export function startingSoonDue(hoursUntilStart: number, hourInCity: number): boolean {
  return hoursUntilStart >= MIN_HOURS
    && hoursUntilStart <= LEAD_HOURS
    && hourInCity >= DAY_FROM && hourInCity < DAY_TO
}

/** The notification body: the lead rounded to the hour, since a morning
 *  event's reminder can be well under six. */
export function startingSoonBody(title: string, time: string | null, hoursUntilStart: number): string {
  const h = Math.max(1, Math.round(hoursUntilStart))
  return `"${title}" starts in ~${h} hour${h === 1 ? '' : 's'}${time ? ` at ${time}` : ''}`
}
