// Shared conversion helper — turns a CupPrizeDonation into a real
// CupSponsor + CupPrize in one atomic step. Used by both
// /api/admin/cup/donations and /api/admin/campaigns/[id]/donations
// so the cup-legacy and campaign-scoped admin flows produce
// identical results.
//
// The conversion is opt-in: a plain `{ action: 'approve' }` PATCH
// still flips the status to 'approved' without creating anything,
// leaving the admin free to wire it manually. When the caller
// passes a `sponsor` and/or `prize` payload, this helper runs
// inside a transaction so a half-failed conversion never leaves
// the donation pointing at a partially-created sponsor.

import type { Prisma } from '@prisma/client'

export interface SponsorPayload {
  // Either reuse an existing sponsor by id…
  existingId?: string
  // …or create a new one.
  name?:        string
  slug?:        string
  blurb?:       string | null
  logoUrl?:     string | null
  websiteUrl?:  string | null
  instagramUrl?: string | null
}

export interface PrizePayload {
  title:       string
  description?: string | null
  rank?:       1 | 2 | 3 | null
  imageUrl?:   string | null
}

export interface ConversionResult {
  sponsorId: string | null
  prizeId:   string
}

const SLUG_RE = /^[a-z0-9-]+$/

export function slugifyForCup(input: string): string {
  return input.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Runs sponsor + prize creation in a single transaction, links
// the donation to both. Throws on validation failure — the caller
// wraps in try/catch and surfaces a 400/409.
export async function convertDonationToPrize(
  tx: Prisma.TransactionClient,
  args: {
    donationId:     string
    campaignId:     string | null
    sponsor?:       SponsorPayload
    prize:          PrizePayload
    reviewedByUserId: string
    reviewNote?:    string | null
  },
): Promise<ConversionResult> {
  const { donationId, campaignId, sponsor, prize, reviewedByUserId, reviewNote } = args

  // ── Sponsor: reuse-by-id or create new ──────────────────────
  let sponsorId: string | null = null
  if (sponsor?.existingId) {
    const exists = await tx.cupSponsor.findUnique({ where: { id: sponsor.existingId }, select: { id: true } })
    if (!exists) throw new Error('Sponsor not found')
    sponsorId = sponsor.existingId
  } else if (sponsor?.name) {
    const name = sponsor.name.trim().slice(0, 200)
    if (!name) throw new Error('Sponsor name required')
    const slug = sponsor.slug?.trim() || slugifyForCup(name)
    if (!SLUG_RE.test(slug)) throw new Error('Sponsor slug must be lowercase letters, digits, hyphens')

    // If slug already taken, append a counter rather than fail —
    // a Mikla donating a second time shouldn't 409 the admin.
    let finalSlug = slug
    let counter = 1
    while (true) {
      const conflict = await tx.cupSponsor.findUnique({ where: { slug: finalSlug }, select: { id: true } })
      if (!conflict) break
      counter += 1
      finalSlug = `${slug}-${counter}`
      if (counter > 50) throw new Error('Could not allocate a unique sponsor slug')
    }

    const created = await tx.cupSponsor.create({
      data: {
        name,
        slug:         finalSlug,
        blurb:        sponsor.blurb        ?? null,
        logoUrl:      sponsor.logoUrl      ?? null,
        websiteUrl:   sponsor.websiteUrl   ?? null,
        instagramUrl: sponsor.instagramUrl ?? null,
        status:       'active',
        addedByUserId: reviewedByUserId,
        campaignId,
      },
      select: { id: true },
    })
    sponsorId = created.id
  }

  // ── Prize: always created ────────────────────────────────────
  const title = prize.title.trim().slice(0, 200)
  if (!title) throw new Error('Prize title required')
  const rank = prize.rank
  if (rank !== undefined && rank !== null && ![1, 2, 3].includes(rank)) {
    throw new Error('Prize rank must be 1, 2, 3, or null')
  }

  const created = await tx.cupPrize.create({
    data: {
      title,
      description: prize.description?.trim().slice(0, 2000) ?? null,
      imageUrl:    prize.imageUrl?.trim().slice(0, 500) ?? null,
      rank:        rank ?? null,
      sponsorId,
      status:      'active',
      campaignId,
    },
    select: { id: true },
  })

  // ── Donation: mark approved + link ───────────────────────────
  await tx.cupPrizeDonation.update({
    where: { id: donationId },
    data: {
      status:           'approved',
      reviewedByUserId,
      reviewedAt:       new Date(),
      reviewNote,
      linkedSponsorId:  sponsorId,
      linkedPrizeId:    created.id,
    },
  })

  return { sponsorId, prizeId: created.id }
}
