import { NextRequest, NextResponse } from 'next/server'
import { getClubBySlug, getEventsByClub } from '@/lib/db'

export async function GET(_: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const club = await getClubBySlug(slug)
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const events = await getEventsByClub(club.id)
  return NextResponse.json({ club, events })
}
