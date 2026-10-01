import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, isAdmin, failClosedCityId } from '@/lib/access'
import { collectSourceUrls, sourceChangesForQueue } from '@/lib/handbookSources'

// For the /admin/posts review queue (lib/handbookSources):
//   changes      — articles whose official source changed since their last review
//   unreachable  — cited sources the weekly sweep couldn't fetch (a dead link
//                  in an article is worth fixing too)
// Same scope as GET /api/admin/posts: admins see every article, a moderator
// their own city's.
export async function GET() {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const posts = await prisma.post.findMany({
      where:  { kind: 'handbook', status: 'published', ...(isAdmin(session) ? {} : { cityId: failClosedCityId(session) }) },
      select: { id: true, slug: true, title: true, lastReviewedAt: true, officialSources: true },
    })
    const urls    = collectSourceUrls(posts)
    const sources = urls.length
      ? await prisma.handbookSource.findMany({ where: { url: { in: urls } }, select: { url: true, changedAt: true, lastDiff: true, lastError: true, checkedAt: true } })
      : []
    const changes = sourceChangesForQueue(posts, sources)

    const citedBy = (url: string) => posts
      .filter(p => Array.isArray(p.officialSources) && (p.officialSources as { url?: string }[]).some(s => s?.url === url))
      .map(p => ({ slug: p.slug, title: p.title }))
    const unreachable = sources
      .filter(s => s.lastError)
      .slice(0, 30)
      .map(s => ({ url: s.url, error: s.lastError, checkedAt: s.checkedAt, articles: citedBy(s.url) }))

    const lastChecked = sources.reduce<Date | null>((m, s) => (s.checkedAt && (!m || s.checkedAt > m) ? s.checkedAt : m), null)
    return NextResponse.json({ changes, unreachable, watched: urls.length, lastChecked })
  } catch (e) {
    console.error('[admin handbook-sources]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
