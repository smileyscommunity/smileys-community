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

/**
 * The city a content page is ABOUT, when its URL doesn't say.
 *
 * `/bodrum` and `/neighborhoods?city=bodrum` announce their city in the URL, so
 * cityCandidatesFromUrl handles them. `/guide/kara-ada-hot-springs` does not:
 * the slug alone identifies the entry, and the city is a property of the row.
 * The footer therefore fell back to the reader's own city and wrote "Find your
 * people in Istanbul" under a Bodrum experience.
 *
 * These are the paths whose subject is a single city's content. A slug that
 * matches no row returns null and the caller falls back as before, so a
 * mistyped URL costs one indexed lookup and changes nothing.
 *
 * A handbook article is the same shape with one wrinkle: the row's city is
 * nullable. A city-local article (Başkentkart, BursaKart) names its city and
 * gets the footer to match; a global one (residence permits, tax numbers) has
 * no city, resolves to null, and keeps following the reader — the page already
 * titles itself that way (see app/handbook/[slug]/page.tsx).
 *
 * Deliberately NOT a general rule for every page: /events and /clubs are
 * feeds of whichever city you're in, so the reader's city is the right answer
 * there and the footer should keep following the session.
 */
export type ContentCityRef = { kind: 'guide' | 'route' | 'neighborhood' | 'handbook'; slug: string }

export function contentCitySlugPath(pathname: string): ContentCityRef | null {
  const parts = pathname.replace(/^\/app(?=\/|$)/, '').split('?')[0].split('/').filter(Boolean)
  if (parts[0] === 'guide' && parts[1] === 'routes' && parts[2]) return { kind: 'route',        slug: parts[2] }
  if (parts[0] === 'guide' && parts[1] && parts[1] !== 'routes') return { kind: 'guide',        slug: parts[1] }
  if (parts[0] === 'neighborhoods' && parts[1])                  return { kind: 'neighborhood', slug: parts[1] }
  if (parts[0] === 'handbook' && parts[1])                       return { kind: 'handbook',     slug: parts[1] }
  return null
}
