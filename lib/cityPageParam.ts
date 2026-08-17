// Which city a city-ambiguous page is about.
//
// Some public pages have no city anywhere in their URL — /neighborhoods is the
// case this exists for. They used to resolve one from the session, which works
// for a person and fails for a crawler: a link-preview bot has no cookie, so
// every share previewed as the default city's page no matter what the sharer
// had on screen.
//
// `?city=<slug>` is what makes such a URL able to say what it means. It follows
// the convention already used by /apply?city=, /visiting/new?city= and
// /api/neighborhoods?city=. The session stays the answer for someone who simply
// navigates to the page.
//
// `pinned` tells the caller whether the city came from the URL. A page uses it
// to decide whether to redirect the bare URL to the explicit one — that
// redirect is what makes the address bar a shareable link — and the flag is
// what stops it looping.
//
// Unknown, paused and non-public slugs fall back to the session rather than
// 404: a stale link should show a page, not an error.

import { getPublicCity } from './cities'
import { getCityConfig, resolveCityId } from './city'
import { getSession } from './session'

export type CitySearch = { city?: string }

export interface ResolvedPageCity {
  city:   Awaited<ReturnType<typeof getCityConfig>>
  cityId: string
  /** True when the city came from ?city=, false when it came from the session. */
  pinned: boolean
}

export async function resolveCityForPage(
  searchParams: Promise<CitySearch> | undefined,
): Promise<ResolvedPageCity> {
  const wanted = (await searchParams)?.city?.trim()
  if (wanted) {
    const c = await getPublicCity(wanted)
    if (c) return { city: await getCityConfig(c.id), cityId: c.id, pinned: true }
  }
  const cityId = await resolveCityId(await getSession())
  return { city: await getCityConfig(cityId), cityId, pinned: false }
}
