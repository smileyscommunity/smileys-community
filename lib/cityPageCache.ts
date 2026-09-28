import { revalidateTag } from 'next/cache'

// The city pages' shared data (app/[city]/data.ts getCityPageData and the
// hubs) and the landing page are cached under the 'home' tag with a 60-second
// TTL. Nothing ever revalidated the tag, so an event pulled by a moderator, a
// deactivated quote or a city's new hero stayed on the public page until the
// minute ran out. The admin writes that change what those pages show call
// this. Safe outside a request (a script, a test): the TTL covers it.
export const CITY_PAGE_TAG = 'home'

export function bustCityPages(): void {
  try { revalidateTag(CITY_PAGE_TAG) } catch { /* no request scope */ }
}
