import { NextRequest, NextResponse } from 'next/server'
import { getSession, createSession, deleteSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json(null)
  try {
    const FIFTEEN_MINUTES = 15 * 60 * 1000
    const [user, clubHostCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.id },
        select: {
          id: true, name: true, email: true, role: true,
          color: true, emailVerified: true, joinedAt: true,
          bio: true, neighborhood: true, instagram: true, linkedin: true, lookingFor: true, profileVisibility: true,
          phone: true, gender: true, nationality: true, languages: true, interests: true, socialStyles: true,
          status: true, membershipType: true, profilePhoto: true, lastActive: true,
          partnerId: true, suspendedUntil: true,
          openToCoffee: true, openToLanguage: true, openToHosting: true,
        },
      }),
      prisma.clubMembership.count({
        where: { userId: session.id, status: 'approved', role: 'host' },
      }),
    ])
    const stale = !user?.lastActive || (Date.now() - new Date(user.lastActive).getTime()) > FIFTEEN_MINUTES
    if (stale) {
      prisma.user.update({ where: { id: session.id }, data: { lastActive: new Date() } }).catch(() => {})
    }
    if (user?.status === 'banned') {
      await deleteSession()
      return NextResponse.json({ error: 'banned' }, { status: 403 })
    }
    if (user?.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      await deleteSession()
      return NextResponse.json({ error: 'suspended' }, { status: 403 })
    }
    // Role changes are a privilege boundary — force re-login rather than silently
    // upgrading the JWT (defends against DB-side role tampering and stolen tokens).
    if (user && user.role !== session.role) {
      await deleteSession()
      return NextResponse.json({ error: 'role_changed' }, { status: 401 })
    }
    // partnerId is not a privilege boundary — safe to auto-update.
    if (user && user.partnerId !== session.partnerId) {
      await createSession({ ...session, partnerId: user.partnerId || undefined })
    }
    if (!user) { await deleteSession(); return NextResponse.json(null) }
    const isClubHost = clubHostCount > 0
    return NextResponse.json({ ...user, isClubHost })
  } catch {
    await deleteSession()
    return NextResponse.json(null)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const allowed = ['name', 'bio', 'neighborhood', 'instagram', 'linkedin', 'lookingFor', 'color',
                     'phone', 'gender', 'nationality', 'languages', 'interests', 'profileVisibility', 'socialStyles', 'emailMarketing',
                     'openToCoffee', 'openToLanguage', 'openToHosting']
    const data: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) data[key] = body[key]
    }

    // profilePhoto must be a local upload path or empty
    if ('profilePhoto' in body) {
      const photo = body.profilePhoto
      if (photo === null || photo === '') {
        data.profilePhoto = null
      } else if (typeof photo === 'string' && /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(photo)) {
        data.profilePhoto = photo
      } else {
        return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
      }
    }

    // Length limits
    if (data.name && String(data.name).length > 100)
      return NextResponse.json({ error: 'Name too long' }, { status: 400 })
    if (data.bio && String(data.bio).length > 1000)
      return NextResponse.json({ error: 'Bio too long' }, { status: 400 })
    if (data.instagram && String(data.instagram).length > 100)
      return NextResponse.json({ error: 'Instagram handle too long' }, { status: 400 })
    if (data.linkedin && String(data.linkedin).length > 100)
      return NextResponse.json({ error: 'LinkedIn too long' }, { status: 400 })

    const updated = await prisma.user.update({ where: { id: session.id }, data })

    await createSession({
      ...session,
      name:  updated.name  ?? session.name,
      color: updated.color ?? session.color,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
