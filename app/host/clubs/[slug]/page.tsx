import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { isAdmin as checkAdmin } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import ClubManagementTabs from './ClubManagementTabs'

export const dynamic = 'force-dynamic'

export default async function HostClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSession()
  if (!session) notFound()

  const isAdmin = checkAdmin(session)

  const club = await prisma.club.findUnique({
    where: { slug },
    select: {
      id: true, name: true, emoji: true, slug: true, isPrivate: true,
      rules: true, spotlightUserId: true, spotlightNote: true, spotlightUpdatedAt: true,
    },
  })
  if (!club) notFound()

  // Admins can manage any club; everyone else must have a host membership
  if (!isAdmin) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership?.status !== 'approved') notFound()
  }

  const [resources, spotlightUser] = await Promise.all([
    prisma.clubResource.findMany({ where: { clubId: club.id }, orderBy: { order: 'asc' } }),
    club.spotlightUserId
      ? prisma.user.findUnique({
          where: { id: club.spotlightUserId },
          select: { id: true, name: true, color: true, profilePhoto: true, bio: true },
        })
      : Promise.resolve(null),
  ])

  const initialSpotlight = spotlightUser
    ? {
        userId:    spotlightUser.id,
        name:      spotlightUser.name,
        color:     spotlightUser.color,
        photo:     spotlightUser.profilePhoto,
        bio:       spotlightUser.bio,
        note:      club.spotlightNote ?? null,
        updatedAt: club.spotlightUpdatedAt?.toISOString() ?? null,
      }
    : null

  return (
    <div className="p-4 sm:p-6 min-h-full">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-3xl shrink-0">{club.emoji}</span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{club.name}</h1>
              <p className="text-sm text-zinc-500">Club Management</p>
            </div>
          </div>
          <Link
            href={`/clubs/${slug}`}
            target="_blank"
            className="text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            View public page ↗
          </Link>
        </div>

        <ClubManagementTabs
          slug={slug}
          currentUserId={session.id}
          isAdmin={isAdmin}
          isPrivate={club.isPrivate}
          initialRules={club.rules ?? null}
          initialResources={resources}
          initialSpotlight={initialSpotlight}
        />
      </div>
    </div>
  )
}
