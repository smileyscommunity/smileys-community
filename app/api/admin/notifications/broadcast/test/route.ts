import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canSendBroadcasts } from '@/lib/access'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { createNotification } from '@/lib/notify'
import { sendBroadcastEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rateLimit'

// The composed broadcast, delivered to the one person who can still change
// it. There was no preview of any kind: the first time anyone saw the email a
// broadcast produces was in 1,704 inboxes. This writes no Broadcast row, takes
// no idempotency claim and counts against nothing but its own hourly cap —
// it is a rehearsal, and the history must not record it as a send.
const TITLE_MAX   = 150
const MESSAGE_MAX = 5_000

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!await rateLimit(`broadcast-test:${session.id}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'That is ten test sends this hour — give the inbox a moment' }, { status: 429 })
  }

  const { title, message, type, channel, imageUrl } = await req.json().catch(() => ({}))
  const cleanTitle   = typeof title   === 'string' ? title.trim()   : ''
  const cleanMessage = typeof message === 'string' ? message.trim() : ''
  if (!cleanTitle || !cleanMessage) return NextResponse.json({ error: 'Title and message required' }, { status: 400 })
  if (cleanTitle.length > TITLE_MAX)     return NextResponse.json({ error: `Keep the title under ${TITLE_MAX} characters` }, { status: 400 })
  if (cleanMessage.length > MESSAGE_MAX) return NextResponse.json({ error: `Keep the message under ${MESSAGE_MAX.toLocaleString('en-US')} characters` }, { status: 400 })

  // Same image rule as the real send — a test that accepted an external URL
  // would be the one place it slipped through.
  const cleanImage = imageUrl ? String(imageUrl).trim() : ''
  if (cleanImage && !isUploadedImageUrl(cleanImage, ['broadcasts'])) {
    return NextResponse.json({ error: 'The image has to be uploaded with the broadcast — an external link is not allowed' }, { status: 400 })
  }
  const image = cleanImage || null

  const me = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } })
  if (!me) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const notifType = type === 'alert' ? 'system_alert' : 'announcement'
  const isEmail   = channel === 'email'

  // The email goes to the sender regardless of their own marketing
  // preference — they asked for this one by name, and it is the thing they
  // are checking.
  // Reported, not assumed: Resend refusing the address is the very thing
  // a rehearsal is for finding.
  let emailSent = false
  if (isEmail) {
    try {
      await sendBroadcastEmail(session.id, me.email, me.name, `[TEST] ${cleanTitle}`, cleanMessage, image)
      emailSent = true
    } catch (e) {
      console.error('[broadcast/test] email failed', String(e))
    }
  }
  // The bell entry is marked as a test in its title so it can't be mistaken
  // for a real announcement later in the list.
  await createNotification(session.id, notifType, `[TEST] ${cleanTitle}`, cleanMessage, undefined, undefined, undefined, { imageUrl: image })

  return NextResponse.json({ ok: true, email: emailSent })
}
