import { NextRequest, NextResponse } from 'next/server'
import { getEvents } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const limit    = Math.min(parseInt(searchParams.get('limit')  ?? '24'), 100)
  const offset   = Math.max(parseInt(searchParams.get('offset') ?? '0'),  0)
  const upParam  = searchParams.get('upcoming')
  const upcoming = upParam === '1' ? true : upParam === '0' ? false : undefined

  const { events, total } = await getEvents({ limit, offset, upcoming })
  return NextResponse.json({ events, total, hasMore: offset + events.length < total })
}
