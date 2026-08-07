// Public-facing "teaser" projection of a listing for unauthenticated
// callers. The /listings index + detail are reachable without login
// (SEO + marketplace pull for prospects), but we deliberately withhold
// anything that would let scrapers harvest member contact info or
// identity. Members signing in get the full shape.
//
// Strips: contact, contactEmail, full description, poster identity. Keeps:
// photo (the visual is the listing's pull for prospects), category, title,
// neighborhood, price, time, id (so deep links still resolve).

const TEASER_DESCRIPTION_LIMIT = 80

export type ListingWithUser = {
  id: string
  category: string
  title: string
  description: string
  price: string | null
  photo: string | null
  photoPosition: number
  contact: string | null
  contactEmail: string | null
  neighborhood: string | null
  status: string
  expiresAt: Date | string
  createdAt: Date | string
  user: { id: string; name: string; color: string; profilePhoto: string | null } | null
}

export function redactListingForGuest<T extends ListingWithUser>(listing: T): T {
  const truncated = listing.description.length > TEASER_DESCRIPTION_LIMIT
    ? listing.description.slice(0, TEASER_DESCRIPTION_LIMIT).trimEnd() + '…'
    : listing.description

  return {
    ...listing,
    description: truncated,
    contact: null,
    contactEmail: null,
    // Gallery is member-only; the cover alone is the guest teaser. Without
    // this the ...spread would pass the new photos array straight through.
    photos: [],
    user: {
      id: 'member',
      name: 'Smileys member',
      color: '#9ca3af',
      profilePhoto: null,
    },
  }
}
