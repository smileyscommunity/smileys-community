import { firstNameOf } from '@/lib/data'

// The public vocabulary for the people who run the community, decided in
// docs/city-lead-rename.md: two nouns and nothing else.
//
//   Host       — runs a club and its events   (ClubMembership.role='host')
//   City Lead  — runs a city                  (CityHost row; the model keeps
//                its old name until the rename in that doc lands)
//
// A title is what a member can be seen holding and can aim for — the
// InterNations "Consul"/"Ambassador" lesson: a visible, named role recruits
// volunteers that an admin setting nobody sees never will. So the same
// two words appear everywhere a host is shown (profile chip, Meet the Hosts,
// the city page) and the ladder below is the stated path between them.
// Pure module: no prisma, so the rules are unit-testable (tests/hostTitles).

export type HostTitle = 'lead' | 'host'

export const HOST_TITLE: Record<HostTitle, string> = {
  lead: 'City Lead',
  host: 'Host',
}

// The path, in the order a member climbs it. Copy lives here so the
// get-involved page, the hosts page and the city section tell one story.
export const HOST_PATH: { title: HostTitle; label: string; how: string; then: string }[] = [
  {
    title: 'host',
    label: HOST_TITLE.host,
    how:   'Start or take over a club and run its events. That is the whole job: pick a place, set a time, welcome whoever comes.',
    then:  'Your profile carries the Host badge and you appear on your city’s Meet the Hosts page.',
  },
  {
    title: 'lead',
    label: HOST_TITLE.lead,
    how:   'Hosts who keep a city’s calendar alive are asked to lead it: run city-wide events, help new hosts start, and shape what the city becomes.',
    then:  'New cities open with a City Lead. If yours doesn’t have one yet, that seat is open.',
  },
]

export interface RosterClub { id: string; name: string; slug: string; emoji: string }

export interface RosterHost {
  id: string
  name: string
  color: string
  profilePhoto: string | null
  /** Selected so a member's view can honor a connections-only profile; never rendered. */
  profileVisibility?: string | null
  title: HostTitle
  clubs: RosterClub[]
  upcomingCount: number
  hostedCount: number
}

/** Leads first; then whoever has something to join; then track record; then name, so the order is stable. */
export function rankHosts(a: RosterHost, b: RosterHost): number {
  if (a.title !== b.title) return a.title === 'lead' ? -1 : 1
  return (b.upcomingCount - a.upcomingCount) || (b.hostedCount - a.hostedCount) || a.name.localeCompare(b.name)
}

/**
 * What a viewer may see of a host roster. Hosts hold a public title, so the
 * roster is a public surface — but the same guest rule as every other one
 * (redactEventForGuest, authorProjector): a first name to say who it is,
 * no photo file to fetch, and no id to follow to a profile. Nate's call,
 * 2026-09-27: a logged-out visitor sees no host's face — the old /hosts page
 * had shown them, and a roster of every host's photo across the cities is
 * exactly what the events review took away from scrapers. Members see it all.
 */
export function projectRosterForViewer<T extends RosterHost>(hosts: T[], signedIn: boolean): T[] {
  if (signedIn) return hosts
  return hosts.map(projectHostForGuest)
}

/** One host as a guest sees them — also what a connections-only host is to a member outside their connections. */
export function projectHostForGuest<T extends RosterHost>(h: T): T {
  return { ...h, id: '', name: firstNameOf(h.name) || h.name, profilePhoto: null }
}

/**
 * The one-line summary under a host's name on a card. With no events it says
 * what the person does, not the title again — the chip beside it already
 * says "City Lead", and every freshly launched city's only card read
 * "★ CITY LEAD  City Lead".
 */
export function hostActivityLine(h: Pick<RosterHost, 'title' | 'upcomingCount' | 'hostedCount'>): string {
  if (h.upcomingCount > 0) return `${h.upcomingCount} upcoming event${h.upcomingCount === 1 ? '' : 's'}`
  if (h.hostedCount > 0) return `${h.hostedCount} event${h.hostedCount === 1 ? '' : 's'} hosted`
  return h.title === 'lead' ? 'Leads the city' : 'Runs a club'
}

/**
 * The hero line over a city's roster. A City Lead IS one of the hosts, so
 * the count says so — "1 host, 1 City Lead" was read as two people on every
 * one-person city. The caller handles zero.
 */
export function rosterSummary(total: number, leads: number, cityName: string): string {
  if (total <= 0) return `${cityName} is looking for its first hosts — the seat is open.`
  if (total === 1) return `${leads > 0 ? `One ${HOST_TITLE.lead}` : 'One host'} — the member who makes ${cityName} happen.`
  const withLeads = leads === 0 ? '' : leads === 1 ? `, one of them the ${HOST_TITLE.lead}` : `, ${leads} of them ${HOST_TITLE.lead}s`
  return `${total} hosts${withLeads} — the members who make ${cityName} happen.`
}
