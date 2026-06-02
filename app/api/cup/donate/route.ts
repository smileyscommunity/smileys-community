import { NextResponse } from 'next/server'

// POST /api/cup/donate
//
// Smileys Cup no longer accepts prize donations — the game
// runs as a pure bragging-rights leaderboard with no prizes
// of any kind. The endpoint stays in place (rather than 404ing)
// so a cached older client doesn't crash on submit; it just
// receives a friendly 410 Gone.
//
// The CupPrize / CupSponsor / CupPrizeDonation models and the
// /admin/campaigns donation-triage UI are preserved in case the
// policy reverses later — only the public submission path is
// closed. The previous handler implementation is in git history
// at the commit that disabled it (search for "Cup: remove all
// prize incentives").

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { error: 'Smileys Cup no longer accepts prize donations. The game runs without prizes; thanks for the thought.' },
    { status: 410 },
  )
}
