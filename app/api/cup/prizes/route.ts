import { NextResponse } from 'next/server'

// GET /api/cup/prizes
//
// Returns an empty array. Smileys Cup runs as a pure
// bragging-rights game — no prizes are awarded. The endpoint
// stays in place rather than 404ing so a cached older client
// (PWA still resident on a member's phone) doesn't crash; it
// just sees an empty board.
//
// The CupPrize / CupSponsor / CupPrizeDonation models are
// preserved in the schema in case the policy changes later;
// this route's job is only to not surface any prize data.

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ prizes: [] })
}
