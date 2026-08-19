import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import ApplyClient from './ApplyClient'

// City-aware metadata. Homepage city cards and member invite links land here
// as /apply?city=<slug>; the OG card (the link-preview image on WhatsApp/
// iMessage) and the title must name THAT city, not a hardcoded Istanbul — a
// Bodrum founder's invite previewed as "Istanbul's curated social community"
// before this. Metadata has to live on a server component to read the param,
// which is why the form moved to ApplyClient and this wrapper exists.
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ city?: string }> },
): Promise<Metadata> {
  const { city: citySlug } = await searchParams
  // Fall back to the default city for a missing/unknown slug — a bad param
  // shouldn't blank the preview, and Istanbul is the honest default.
  const city = citySlug && citySlug !== DEFAULT_CITY_SLUG ? await getPublicCity(citySlug) : null
  const cityName = city?.name ?? 'Istanbul'

  const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
    title:   'Apply to Join Smileys',
    eyebrow: `${cityName}'s curated social community`,
    cta:     '5-minute application',
  }).toString()}`

  const description = `Apply to become a member of Smileys Community in ${cityName}. Meet expats and locals through curated events, clubs, and genuine social experiences.`
  const url = citySlug ? `${APP_URL}/apply?city=${encodeURIComponent(citySlug)}` : `${APP_URL}/apply`

  return {
    alternates: { canonical: `${APP_URL}/apply` },
    title: `Apply to Join Smileys — ${cityName}'s Curated Social Community`,
    description,
    openGraph: {
      title: `Apply to Join Smileys Community`,
      description: `Join ${cityName}'s most vibrant curated social community. Application takes 5 minutes.`,
      url,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `Apply to Join Smileys ${cityName}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Apply to Join Smileys Community',
      description: `Join ${cityName}'s most vibrant curated social community. Application takes 5 minutes.`,
      images: [ogImage],
    },
  }
}

export default function ApplyPage() {
  return <ApplyClient />
}
