import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { sendListingAlertEmail } from '@/lib/email'
import { sendPushToUser } from '@/lib/push'

const VALID_CATEGORIES = ['ROOMS', 'JOBS', 'BUY_SELL', 'SERVICES', 'FREE', 'RECO']
const CAT_LABELS: Record<string, string> = {
  ROOMS: 'Room', JOBS: 'Job', BUY_SELL: 'Buy/Sell',
  SERVICES: 'Service', FREE: 'Free stuff', RECO: 'Recommendation',
}

// Admin-only batch listing creator — built for seeding (10–20 housing posts pulled
// from Sahibinden / WhatsApp groups). Each item can be attributed to an arbitrary
// approved user so the listings don't all show "posted by Admin Name".

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { category, attributedUserId, items } = await req.json()

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items' }, { status: 400 })
  }
  if (items.length > 50) {
    return NextResponse.json({ error: 'Too many items (max 50 per batch)' }, { status: 400 })
  }

  // Resolve attribution: default to acting admin if no userId provided, else verify
  // the target user exists and is approved (don't let admin post under banned/pending).
  const userId = (attributedUserId as string | undefined)?.trim() || session.id
  if (userId !== session.id) {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    })
    if (!target || target.status !== 'approved') {
      return NextResponse.json({ error: 'Attribution user not found or not approved' }, { status: 400 })
    }
  }

  // Validate each item before writing anything — atomic-ish (we don't wrap in a tx
  // because alerts fire per-create; if one fails it fails the batch).
  const photoRegex = /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/
  const cleaned = items.map((raw, i) => {
    const title = String(raw.title ?? '').trim()
    const description = String(raw.description ?? '').trim()
    if (!title) throw new Error(`Item ${i + 1}: title required`)
    if (!description) throw new Error(`Item ${i + 1}: description required`)
    if (title.length > 120) throw new Error(`Item ${i + 1}: title too long`)
    if (description.length > 2000) throw new Error(`Item ${i + 1}: description too long`)
    const price = raw.price ? String(raw.price).trim().slice(0, 100) : null
    const contact = raw.contact ? String(raw.contact).trim().slice(0, 200) : null
    const photo = typeof raw.photo === 'string' && photoRegex.test(raw.photo) ? raw.photo : null
    return { title, description, price, contact, photo }
  })

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  try {
    const created = await prisma.$transaction(
      cleaned.map(c =>
        prisma.listing.create({
          data: { userId, category, ...c, expiresAt },
        })
      )
    )

    // Fire alerts once for the whole batch — one email/push per subscriber listing
    // the batch's category, summarising the count. Avoids spamming N notifications
    // when admin drops 20 housing listings at once.
    const categoryLabel = CAT_LABELS[category] ?? category
    prisma.user.findMany({
      where: { listingAlerts: { has: category }, id: { not: userId } },
      select: { id: true, email: true, name: true },
    }).then(alertees => {
      for (const u of alertees) {
        sendListingAlertEmail(u.email, u.name, categoryLabel, {
          title: `${created.length} new ${categoryLabel.toLowerCase()} listings`,
          description: created.slice(0, 5).map(l => `• ${l.title}`).join('\n'),
        }).catch(() => {})
        sendPushToUser(u.id, {
          title: `${created.length} new ${categoryLabel.toLowerCase()} listings`,
          body:  created[0]?.title ?? 'Check the marketplace',
          link:  '/listings',
        }).catch(() => {})
      }
    }).catch(() => {})

    return NextResponse.json({ created: created.length, ids: created.map(l => l.id) }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    console.error('[bulk listings]', e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
