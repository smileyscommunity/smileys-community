import Image from 'next/image'
import { resolveImageUrl } from '@/lib/data'

// The city's own photo, or — for a city without one yet — a plain brand panel
// with its name. It fell back to Istanbul's hero photo, captioned "Smileys
// members in <city>", while the share card fell back to the brand card: the
// page showed one city's picture under another's name, and the preview
// disagreed with the page. The alt describes what a hero photo is (a view of
// the city), not people who may not be in it.
export default function CityHeroImage({ city, sizes }: { city: { name: string; heroImage: string | null }; sizes: string }) {
  if (!city.heroImage) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 flex items-center justify-center">
        <span className="text-white text-4xl md:text-5xl font-extrabold tracking-tight drop-shadow-sm">{city.name}</span>
      </div>
    )
  }
  return (
    <Image
      src={resolveImageUrl(city.heroImage)}
      alt={city.name}
      fill
      priority
      fetchPriority="high"
      sizes={sizes}
      className="object-cover"
    />
  )
}
