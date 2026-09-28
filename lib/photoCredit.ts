// Pure rules for a listing cover's photo credit (Business.coverCredit), shared
// by components/PhotoCredit and the server pages. No JSX, no prisma.

/**
 * Whether a cover may be used where no credit can be shown (og:image, JSON-LD
 * image): only when it needs none. A Commons photo under CC BY / BY-SA must
 * carry its author and licence wherever it appears.
 */
export function creditedCoverOk(b: { coverImage?: string | null; coverCredit?: string | null }): boolean {
  return !!b.coverImage && !b.coverCredit?.trim()
}
