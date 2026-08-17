/**
 * The candidate city slug for a request path — the first path segment.
 *
 * The root layout uses this to tell WHICH city shopfront it is wrapping.
 * A layout receives no params, so middleware forwards the path as the
 * `x-pathname` header; this pulls the segment out, and the layout checks it
 * against real city rows (that needs prisma, which the edge middleware has
 * no access to). A segment that isn't a city — `events`, `clubs`, `about` —
 * matches no row and changes nothing.
 *
 * `nextUrl.pathname` arrives with the `/app` basePath already stripped, but
 * this tolerates both shapes rather than depending on that. The lookahead
 * matters: `/apply` must not lose its first four characters.
 */
export function pathCitySlug(pathname: string): string {
  return pathname
    .replace(/^\/app(?=\/|$)/, '')
    .split('/')
    .filter(Boolean)[0] ?? ''
}
