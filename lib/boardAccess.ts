import { prisma } from '@/lib/prisma'

// ── Who can read what on the community board ────────────────────────────────
//
// One read gate for every surface that lists board posts — the feed, the deep
// link, the replies, the neighbourhood pages, club health. Each used to carry
// its own copy; the neighbourhood pages' copy had none of the author or
// private-club conditions, so a private club's post showed on a public page.
// Server only (lib/board.ts is the client-safe half).

/** Authors whose posts and replies are shown: approved, not hidden. */
export const LIVE_BOARD_AUTHOR = { status: 'approved', hiddenFromMembers: false } as const

/**
 * A post anyone may read (`viewerId` null), or this member may: active, by a
 * live author, not in a private club — unless the viewer is in that club.
 */
export function readablePostWhere(viewerId: string | null) {
  return {
    status: 'active',
    user:   LIVE_BOARD_AUTHOR,
    OR: [
      { clubId: null },
      { club: { isPrivate: false } },
      ...(viewerId ? [{ club: { memberships: { some: { userId: viewerId, status: 'approved' } } } }] : []),
    ],
  }
}

/** Replies that are shown and counted: not taken down, by a live author. */
export const SHOWN_REPLY = { removedAt: null, user: LIVE_BOARD_AUTHOR } as const

/** Everyone the viewer blocked or was blocked by — neither sees the other. */
export async function blockedPairIds(viewerId: string | null): Promise<string[]> {
  if (!viewerId) return []
  const rows = await prisma.memberBlock.findMany({
    where:  { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  })
  return rows.map(b => (b.blockerId === viewerId ? b.blockedId : b.blockerId))
}

// ── What a guest reads ──────────────────────────────────────────────────────
//
// Posts and replies are public so the board works as a front door, but a
// free-text body can carry a WhatsApp group invite, a phone number or an
// email — a guest could join the group and read every member's number. For
// guests those are cut out; members see the text as written.

const INVITE_LINK = /\b(?:https?:\/\/)?(?:chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com|t\.me|telegram\.me|discord\.gg|discord\.com\/invite)\/\S*/gi
const EMAIL       = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// A run of digits with the usual phone separators; kept when it has fewer
// than seven digits (a year, a price, "3-4 people") or reads as a date.
const PHONE_LIKE  = /(?:\+|00)?\d[\d\s().-]{5,}\d/g
const DATE_LIKE   = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/

export function redactBoardTextForGuest(text: string): string {
  return text
    .replace(INVITE_LINK, '[link for members]')
    .replace(EMAIL, '[email for members]')
    .replace(PHONE_LIKE, m => (m.replace(/\D/g, '').length >= 7 && !DATE_LIKE.test(m.trim()) ? '[number for members]' : m))
}
