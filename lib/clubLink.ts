// Where a club link goes. Club pages live in the members-only route group
// (app/(member)/clubs/[slug]), whose layout renders nothing for a guest and
// then sends them to /login — so a guest following a club card from a public
// page (the city page, /<city>/clubs, the /clubs directory) landed on an
// empty page and a login form for an account they don't have. A guest is
// sent to the application instead, for the club's city when the caller knows
// it. Members, and anyone whose sign-in state hasn't resolved yet, get the
// club page: sending a member to the application form is the worse mistake.
export function clubHref(slug: string, viewer: 'member' | 'guest' | 'unknown', citySlug?: string | null): string {
  if (viewer === 'guest') return citySlug ? `/apply?city=${encodeURIComponent(citySlug)}` : '/apply'
  return `/clubs/${slug}`
}
