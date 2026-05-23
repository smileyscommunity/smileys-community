import { NextRequest, NextResponse } from 'next/server'
import { getEventById } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await getSession()

  // Strip sensitive fields from unauthenticated responses
  if (!session) {
    const { whatsappUrl, meetingUrl, address, ...publicEvent } = event as any
    return NextResponse.json(publicEvent)
  }

  return NextResponse.json(event)
}
