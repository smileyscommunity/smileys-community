import Link from 'next/link'
import Image from 'next/image'
import { avatarUrl, BLUR_PLACEHOLDER } from '@/lib/data'
import { clubHref } from '@/lib/clubLink'
import { HOST_TITLE, hostActivityLine, type RosterHost } from '@/lib/hostTitles'

// One host on a roster (Meet the Hosts, the per-city hub, the city page's
// section). The title chip is the point of the card: a name people can see
// and aim for. Takes an already-projected host — a guest's arrives with an
// empty id (no profile to follow) and a first name (lib/hostTitles). A
// guest can't open a club page either — they go to the city's application
// (lib/clubLink), same as every club card.
export default function HostRosterCard({ host: h, signedIn, citySlug, compact = false }: {
  host: RosterHost; signedIn: boolean; citySlug: string; compact?: boolean
}) {
  const lead = h.title === 'lead'
  const chip = (
    <span className={`inline-flex items-center text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
      lead ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
    }`}>
      {lead && <span aria-hidden="true" className="mr-1">★</span>}{HOST_TITLE[h.title]}
    </span>
  )
  const name = h.id
    ? <Link href={`/members/${h.id}`} className="font-bold text-gray-900 truncate hover:text-amber-600 transition-colors">{h.name}</Link>
    : <p className="font-bold text-gray-900 truncate">{h.name}</p>

  return (
    <div className={`card flex flex-col ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center gap-3 mb-3">
        {h.profilePhoto ? (
          <Image
            src={avatarUrl(h.profilePhoto, 96)}
            alt={h.name}
            width={56} height={56}
            placeholder="blur" blurDataURL={BLUR_PLACEHOLDER}
            className="w-14 h-14 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
            style={{ backgroundColor: h.color }}
            aria-hidden="true"
          >
            {h.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">{name}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {chip}
            <span className="text-xs text-gray-500">{hostActivityLine(h)}</span>
          </div>
        </div>
      </div>
      {h.clubs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-auto">
          {h.clubs.slice(0, 3).map(c => (
            <Link key={c.id} href={clubHref(c.slug, signedIn ? 'member' : 'guest', citySlug)}
              className="inline-flex items-center gap-1 text-xs font-semibold bg-gray-50 hover:bg-amber-50 border border-gray-100 rounded-full px-2.5 py-1 text-gray-700 transition-colors">
              <span aria-hidden="true">{c.emoji}</span> {c.name}
            </Link>
          ))}
          {h.clubs.length > 3 && (
            <span className="text-xs text-gray-400 self-center">+{h.clubs.length - 3} more</span>
          )}
        </div>
      )}
    </div>
  )
}
