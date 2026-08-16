// One-off (Clubs redesign phase 2): copy the legacy club wall posts into
// the Board as club-tagged posts, per the brief's §18 — conversations are
// canonical Board records; clubs surface them. Volumes are tiny (21 posts,
// 4 replies at audit time), and the old club_posts tables stay untouched
// so the current wall keeps working until phase 4 swaps the UI.
//
// Idempotent by construction: migrated rows use deterministic ids
// ('cbmig-<clubPostId>' / 'cbmigr-<replyId>'), so re-runs skip existing.
// Likes are NOT migrated (Board has no per-post like; 'save' has different
// semantics) — noted and accepted in the audit.
//
// Usage (server):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/migrate-club-posts-to-board.ts
//   npx tsx --env-file=.env --env-file=.env.local scripts/migrate-club-posts-to-board.ts
import { prisma } from '../lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

// First line (or first ~100 chars at a word boundary) becomes the Board
// title; the remainder stays in the body. Board titles cap at 120.
function splitTitle(content: string): { title: string; body: string } {
  const trimmed = content.trim()
  const firstLine = trimmed.split('\n')[0].trim()
  if (firstLine.length <= 110) {
    const body = trimmed.slice(trimmed.indexOf(firstLine) + firstLine.length).trim()
    return { title: firstLine || 'Club post', body }
  }
  const cut = firstLine.slice(0, 100)
  const at = cut.lastIndexOf(' ')
  const title = (at > 40 ? cut.slice(0, at) : cut) + '…'
  return { title, body: trimmed }
}

async function main() {
  const posts = await prisma.clubPost.findMany({
    include: { replies: true, club: { select: { name: true, slug: true, cityId: true } } },
    orderBy: { createdAt: 'asc' },
  })

  let created = 0, skipped = 0, repliesCreated = 0
  for (const p of posts) {
    const boardId = `cbmig-${p.id}`
    const exists = await prisma.boardPost.findUnique({ where: { id: boardId }, select: { id: true } })
    if (exists) { skipped++ } else {
      const { title, body } = splitTitle(p.content)
      console.log(`${DRY_RUN ? '[dry] ' : ''}${p.club.slug}: ${JSON.stringify(title.slice(0, 60))} (${p.replies.length} replies)`)
      if (!DRY_RUN) {
        await prisma.boardPost.create({
          data: {
            id: boardId,
            userId: p.userId,
            // The board post inherits the club's city. This one-off ran
            // before global (cityId-null) clubs existed; if ever re-run,
            // fail loudly rather than write a null into a required column.
            cityId: p.club.cityId ?? (() => { throw new Error(`club ${p.club.slug} is global — pick a city for its posts`) })(),
            type: 'share',
            title,
            body,
            clubId: p.clubId,
            createdAt: p.createdAt,
          },
        })
      }
      created++
    }
    for (const r of p.replies) {
      const replyId = `cbmigr-${r.id}`
      const rExists = await prisma.boardReply.findUnique({ where: { id: replyId }, select: { id: true } })
      if (rExists) continue
      if (!DRY_RUN) {
        await prisma.boardReply.create({
          data: {
            id: replyId,
            postId: boardId,
            userId: r.userId,
            body: r.content.trim().slice(0, 500),
            createdAt: r.createdAt,
          },
        })
      }
      repliesCreated++
    }
  }
  console.log(`\nposts: ${created} ${DRY_RUN ? 'would be ' : ''}migrated, ${skipped} already present · replies: ${repliesCreated}${DRY_RUN ? ' (dry run)' : ''}`)
}

main().finally(() => prisma.$disconnect())
