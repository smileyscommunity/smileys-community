import JoinCityButton from '@/components/JoinCityButton'
import type { PublicCity, EnterLink } from '../data'

export default function FinalCta({ city, signedIn, newMembersThisWeek, enter }: {
  city: PublicCity; signedIn: boolean; newMembersThisWeek: number; enter: EnterLink
}) {
  return (
    <section className="py-16 sm:py-20 bg-white border-t border-gray-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
          Ready to find your people?
        </h2>
        <p className="text-lg text-gray-600 mb-8">
          {/* "Join Smileys" to someone already signed in is an invitation to
              apply to a community they're already in. */}
          {signedIn
            ? `See what's on in ${city.name} this week.`
            : `Join Smileys and start building your social life in ${city.name}.`}
          {newMembersThisWeek > 0 && ` ${newMembersThisWeek} new member${newMembersThisWeek === 1 ? '' : 's'} joined this week.`}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          {/* Same component the hero uses, and for the same reason: it is the
              one place that knows whether the viewer is a guest (apply), a
              member of another city (join this one), or already in (a badge).
              This section owned a bare /apply link instead — exactly the bug
              JoinCityButton's comment describes, left behind when the hero
              was fixed. */}
          <JoinCityButton slug={city.slug} name={city.name} />
          <a href={enter('events')} className="btn-secondary text-base px-8 py-4">
            {signedIn ? 'Browse events' : 'Browse events first'}
          </a>
        </div>
      </div>
    </section>
  )
}
