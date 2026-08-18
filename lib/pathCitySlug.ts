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

/**
 * Every slug a URL offers as its city, best first.
 *
 * Two shapes carry a city now, and the footer has to honour both. A city
 * shopfront puts it in the path (`/bodrum`); the pages that have no city of
 * their own put it in the query (`/neighborhoods?city=bodrum`,
 * `/visiting?city=izmir`). Reading only the path meant every one of those
 * query pages rendered "Find your people in Istanbul" beneath Izmir's content
 * — the same bug the path fix was written to kill, one URL shape over.
 *
 * `?city=` wins: a page that says outright which city it is about is a
 * stronger signal than the segment it happens to live under. Callers check
 * these against real city rows, so a non-city first segment ("events",
 * "clubs") simply matches nothing.
 */
export function cityCandidatesFromUrl(pathAndSearch: string): string[] {
  const [path, search = ''] = pathAndSearch.split('?')
  const fromQuery = new URLSearchParams(search).get('city')?.trim() ?? ''
  const fromPath  = pathCitySlug(path)
  return [...new Set([fromQuery, fromPath].filter(Boolean))]
}
