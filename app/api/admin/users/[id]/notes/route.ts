import { canManageUsers } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageUsers(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const { text } = await req.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Note text is required' }, { status: 400 })
    }

    const note = await prisma.adminNote.create({
      data: {
        userId:    id,
        adminId:   session.id,
        adminName: session.name,
        text:      text.trim(),
      }
    })

    return NextResponse.json(note)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
