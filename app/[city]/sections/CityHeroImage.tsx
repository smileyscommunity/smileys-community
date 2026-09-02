import Image from 'next/image'
import { resolveImageUrl } from '@/lib/data'

// Falls back to the shared community photo when a city has no hero of its own,
// so a newly-live city is never a grey box.
export default function CityHeroImage({ city, sizes }: { city: { name: string; heroImage: string | null }; sizes: string }) {
  return (
    <Image
      src={city.heroImage ? resolveImageUrl(city.heroImage) : '/app/images/hero-istanbul.jpg'}
      alt={`Smileys members in ${city.name}`}
      fill
      priority
      fetchPriority="high"
      sizes={sizes}
      className="object-cover"
    />
  )
}
