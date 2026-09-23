import { redirect } from 'next/navigation'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'

// /moving — the city-agnostic entry the landing page links to, like
// /remote-work: ?city= when the link carries one, else the session's city,
// else the default. A city that isn't live has no hub, so it falls back to
// the default city's rather than bouncing through a pre-launch page.

export default async function MovingEntry({ searchParams }: { searchParams?: Promise<CitySearch> }) {
  const { city } = await resolveCityForPage(searchParams)
  const pub = await getPublicCity(city.slug)
  redirect(`/${pub?.status === CITY_STATUS.Live ? city.slug : DEFAULT_CITY_SLUG}/moving`)
}
