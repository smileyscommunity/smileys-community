import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { resolveCityId, describeCity, getCityConfig } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'

// The city this request's feeds resolve to (view-city cookie → member's
// home city → default). Public. Page headers use it to name the city
// they're showing and to offer the "back to my city" switch: /api/events
// carries the same info inline, but endpoints with array-shaped responses
// (clubs) can't grow a field without breaking consumers, so their pages
// ask here instead.
//
// `posting` answers a different question: not "which city am I looking at"
// but "which city would a post from me land in". They diverge, deliberately —
// resolvePostingCityId files a write to your home city unless you actually
// belong to the one you're browsing, because alert fan-out matches subscribers
// on their home city and a listing filed into a city you merely looked at
// reaches nobody. Correct, and invisible: the compose form said nothing, so a
// member browsing another city's marketplace had no way to know where their
// listing was going. Now it can say.
//
// Computed here rather than inside describeCity on purpose: lib/cityMembership
// imports resolveCityId from lib/city, so calling it from there would close an
// import cycle.
export async function GET() {
  const session = await getSession()
  const viewedId = await resolveCityId(session)
  const base = await describeCity(viewedId, session)

  // Guests have no membership and nothing to post with, so there is nothing
  // truthful to say — the field is simply absent for them.
  if (!session) return NextResponse.json(base)

  // Costs an extra query only when the viewer has browsed off their own city:
  // resolvePostingCityId returns early when viewed === home, which is almost
  // every request.
  const postingId = await resolvePostingCityId(session)
  if (postingId === viewedId) {
    return NextResponse.json({ ...base, posting: { name: base.name, slug: base.slug, differs: false } })
  }
  const cfg = await getCityConfig(postingId)
  return NextResponse.json({ ...base, posting: { name: cfg.name, slug: cfg.slug, differs: true } })
}
