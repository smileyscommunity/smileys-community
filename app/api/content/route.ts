import { NextResponse } from 'next/server'
import { loadContent } from '@/lib/content'

export async function GET() {
  return NextResponse.json(loadContent())
}
