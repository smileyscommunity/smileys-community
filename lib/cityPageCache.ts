import { revalidateTag } from 'next/cache'

// The city pages' shared data (app/[city]/data.ts getCityPageData and the
// hubs) and the landing page are cached under the 'home' tag with a 60-second
// TTL. Nothing ever revalidated the tag, so an event pulled by a moderator, a
// deactivated quote or a city's new hero stayed on the public page until the
// minute ran out. The admin writes that change what those pages show call
// this. Safe outside a request (a script, a test): the TTL covers it.
export const CITY_PAGE_TAG = 'home'
// /why reads the same things per city (quotes, clubs, the next seven days of
// events, story photos) under its own 5-minute cache; nothing cleared it, so
// a hidden quote stayed on the page. Every caller here changes what it shows.
export const WHY_PAGE_TAG = 'why-page'

export function bustCityPages(): void {
  try { revalidateTag(CITY_PAGE_TAG); revalidateTag(WHY_PAGE_TAG) } catch { /* no request scope */ }
}
