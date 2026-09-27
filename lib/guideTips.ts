// Server-side reads behind an experience page's member layer: the viewer's
// save/recommend/done state with the public recommend count, and the tips
// list with authors projected for the reader.
//
// Shared by the page (which renders them into the first response) and the
// API routes (which the islands call after a mutation). They used to live in
// the routes alone, and the page's islands fetched them after hydration on
// the theory that the page was ISR-cached and could not know the viewer —
// but the root layout reads cookies, so every guide route is dynamic and
// already knows. Two extra round trips per view, and a "Tips" heading that
// flashed and vanished for every guest, for nothing.

import { prisma } from './prisma'
import { authorProjector } from './authorProjection'
import { blockedPairIds } from './boardAccess'
import type { SessionUser } from './session'

export interface GuideViewerState {
  recommendCount: number
  viewer: { saved: boolean; recommended: boolean; done: boolean } | null
}

export async function guideViewerState(slug: string, cityId: string, session: SessionUser | null): Promise<GuideViewerState> {
  const [recommendCount, mine] = await Promise.all([
    // Scoped to the city that owns the experience — a slug reused by two
    // cities must not pool their recommendations.
    prisma.guideSave.count({ where: { cityId, slug, recommended: true } }),
    session
      ? prisma.guideSave.findUnique({
          where:  { userId_cityId_slug: { userId: session.id, cityId, slug } },
          select: { saved: true, recommended: true, done: true },
        })
      : Promise.resolve(null),
  ])
  return {
    recommendCount,
    viewer: session ? { saved: mine?.saved ?? false, recommended: mine?.recommended ?? false, done: mine?.done ?? false } : null,
  }
}

export interface ShownTip {
  id: string
  body: string
  createdAt: string
  user: { id: string; name: string; color: string; profilePhoto: string | null }
  likeCount: number
  viewerLiked: boolean
  mine: boolean
}

export async function listGuideTips(slug: string, cityId: string, session: SessionUser | null): Promise<ShownTip[]> {
  // A pair who blocked each other see neither's tips — same rule as the
  // board. Empty for guests.
  const blocked = await blockedPairIds(session?.id ?? null)
  const tips = await prisma.guideTip.findMany({
    // §48 (Members brief): deactivated/banned authors drop out of discovery
    // surfaces — their tips hide rather than showing a ghost.
    // hiddenFromMembers is the admin's "not listed anywhere" switch; every
    // sibling surface (board, hangouts, rosters) honours it.
    where: {
      slug, cityId,
      user: { status: 'approved', hiddenFromMembers: false },
      ...(blocked.length ? { userId: { notIn: blocked } } : {}),
    },
    orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
    take:    30,
    select: {
      id: true, body: true, createdAt: true,
      user:   { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
      _count: { select: { likes: true } },
      ...(session ? { likes: { where: { userId: session.id }, select: { userId: true } } } : {}),
    },
  })

  // Authors follow lib/authorProjection: a first name and no photo for
  // guests, the connections-only rule for members.
  const project = await authorProjector(session, tips.map(t => t.user))
  return tips.map(t => ({
    id: t.id, body: t.body, createdAt: t.createdAt.toISOString(), user: project(t.user),
    likeCount:   t._count.likes,
    viewerLiked: session ? (t as { likes?: unknown[] }).likes!.length > 0 : false,
    mine:        session ? t.user.id === session.id : false,
  }))
}
