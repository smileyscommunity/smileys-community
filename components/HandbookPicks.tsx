import Image from 'next/image'
import Link from 'next/link'
import { cityQs } from '@/lib/cityPageParam'
import type { CityHandbookPick } from '@/lib/cityHandbookPicks'

// The Handbook articles written for this city (lib/cityHandbookPicks), as
// small cover cards. Used on the city page and on the four arrival hubs
// (moving, remote work, students, visiting), each of which otherwise listed
// its articles as plain titles. Links keep the city; hidden when the city has
// no article of its own yet.
export default function HandbookPicks({ citySlug, picks, className = '' }: { citySlug: string; picks: CityHandbookPick[]; className?: string }) {
  if (picks.length === 0) return null
  return (
    <div className={className}>
      <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Start here</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {picks.map(p => (
          <Link key={p.slug} href={`/handbook/${p.slug}${cityQs(citySlug)}`} className="group card overflow-hidden bg-white hover:-translate-y-0.5 transition-transform duration-300">
            {p.cover && (
              <div className="relative aspect-[16/9]">
                <Image src={p.cover} alt="" fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" />
              </div>
            )}
            <div className="p-4">
              <h3 className="font-bold text-gray-900 text-sm leading-snug group-hover:text-amber-600 transition-colors line-clamp-2">{p.title}</h3>
              {p.excerpt && <p className="mt-1 text-xs text-gray-600 leading-relaxed line-clamp-2">{p.excerpt}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
