import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { APP_URL, SITE_URL } from '@/lib/env'
import { resolveImageUrl } from '@/lib/data'
import MemberProfileClient from './MemberProfileClient'

function absolutePhoto(photo: string | null | undefined): string | undefined {
  if (!photo) return undefined
  const resolved = resolveImageUrl(photo)
  // ?w=1200 hits the file route's PREVIEW resize: aspect-preserved
  // JPEG q75 keeps the OG image under WhatsApp / iMessage / X's
  // ~600 KB cap. Member upload originals are 1200×1200 PNG, ~1-3 MB.
  return resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}?w=1200`
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params
  const member = await prisma.user.findUnique({
    where:  { id, status: 'approved' },
    select: { name: true, bio: true, neighborhood: true, profilePhoto: true },
  })
  if (!member) return {}

  const title = `${member.name} — Smileys Community`
  const description = member.bio
    ? member.bio.slice(0, 155)
    : member.neighborhood
    ? `${member.name} is a Smileys member in ${member.neighborhood}, Istanbul.`
    : `${member.name} is a member of Smileys Community Istanbul.`
  const imageUrl = absolutePhoto(member.profilePhoto) ?? `${APP_URL}/api/og`
  const pageUrl  = `${APP_URL}/members/${id}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Smileys Community',
      images: [{ url: imageUrl, width: 400, height: 400, alt: member.name }],
      type: 'profile',
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [imageUrl],
    },
  }
}

export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <MemberProfileClient params={params} />
}
