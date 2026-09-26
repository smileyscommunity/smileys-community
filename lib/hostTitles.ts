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
 * (redactEventForGuest, authorProjector): a first name to say who it is and
 * no id to follow to a profile. The photo stays: a Meet the Hosts page of
 * initials recruits nobody, and the /hosts page has shown faces to guests
 * since it launched. Flip `profilePhoto` to null here to change that
 * everywhere at once.
 */
export function projectRosterForViewer<T extends RosterHost>(hosts: T[], signedIn: boolean): T[] {
  if (signedIn) return hosts
  return hosts.map(h => ({ ...h, id: '', name: firstNameOf(h.name) || h.name }))
}

/** The one-line summary under a host's name on a card. */
export function hostActivityLine(h: Pick<RosterHost, 'title' | 'upcomingCount' | 'hostedCount'>): string {
  if (h.upcomingCount > 0) return `${h.upcomingCount} upcoming event${h.upcomingCount === 1 ? '' : 's'}`
  if (h.hostedCount > 0) return `${h.hostedCount} event${h.hostedCount === 1 ? '' : 's'} hosted`
  return HOST_TITLE[h.title]
}
