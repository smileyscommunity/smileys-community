import { NextResponse } from 'next/server'
import { getClubs } from '@/lib/db'

export async function GET() {
  const clubs = await getClubs()
  return NextResponse.json(clubs)
}
