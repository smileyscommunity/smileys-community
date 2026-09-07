/**
 * How a club reads in an admin picker.
 *
 * Every city launched from lib/clubTemplates gets a full copy of the lineup,
 * and only three of the thirteen templates interpolate the city into the name
 * ("Social {city}", "Eat Up {city}", "New in {city}"). The other ten are
 * byte-identical everywhere — Hiking Club, Book Club, Coffee & Conversation,
 * Run Club and the rest. Slugs are city-scoped (`hiking-antalya`) so the data
 * is unambiguous; only the display name collides.
 *
 * The admin club endpoint returns the whole network, so with several cities
 * live a picker showed "Coffee & Conversation" five times over with nothing
 * to tell them apart. That is not cosmetic on the event form: an event
 * inherits its city from its parent club, so choosing the wrong identical row
 * files the event in the wrong city, silently and with no error to notice.
 *
 * Deliberately labels EVERY city, including the default one — unlike
 * CityBadge, which stays silent for the default city on purpose (a badge on
 * a thousand Istanbul rows is noise). The reasoning inverts here: in a list
 * you are scanning for the row that stands out, but in a picker you are
 * choosing, and an unlabelled option only reads as "Istanbul" if you already
 * know the convention. The cost of a redundant word is much lower than the
 * cost of a wrong-city event.
 */
export interface ClubLabelInput {
  name:   string
  emoji?: string | null
  /** Null/absent = a global club: listed in every city, owned by none. */
  city?:  { name: string } | null
}

export function clubOptionLabel(club: ClubLabelInput): string {
  const head = [club.emoji, club.name].filter(Boolean).join(' ')
  return `${head} — ${club.city?.name ?? 'all cities'}`
}
