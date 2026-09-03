// Repoint the 67 host briefing notifications sent on 3 Sep 2026.
//
// They were created with link=/posts/how-free-event-spots-work — the MEMBER
// article — under a title promising the host's side of the system. Tapping one
// landed a host on a page that never mentions clearing a card. This points them
// at the host guide instead.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/repoint-host-no-show-notifications.ts
//
// Idempotent and narrow: matched on type + exact old link + the known title, so
// re-running finds nothing and no other notification can be caught by it.
import { prisma } from '@/lib/prisma'
import { NO_SHOW_POLICY_PATH } from '@/lib/noShowPolicy'
import { HOST_GUIDE_SLUG } from './publish-no-show-host-guide'

const DRY_RUN  = process.env.DRY_RUN === '1'
const OLD_LINK = NO_SHOW_POLICY_PATH
const NEW_LINK = `/posts/${HOST_GUIDE_SLUG}`
const TITLE    = '🟨 How no-show cards work on your events'

async function main() {
  // The destination must exist before anything is pointed at it.
  const guide = await prisma.post.findUnique({ where: { slug: HOST_GUIDE_SLUG }, select: { status: true } })
  if (!guide)                      throw new Error(`Host guide not published yet — run publish-no-show-host-guide.ts first`)
  if (guide.status !== 'published') throw new Error(`Host guide is ${guide.status}, not published`)

  const where = { type: 'broadcast', title: TITLE, link: OLD_LINK }
  const stale = await prisma.notification.count({ where })
  console.log(`→ ${stale} host notifications still pointing at ${OLD_LINK}`)
  console.log(`  new link  ${NEW_LINK}`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing changed'); return }
  if (stale === 0) { console.log('✓ nothing to repoint'); return }

  const { count } = await prisma.notification.updateMany({ where, data: { link: NEW_LINK } })
  console.log(`✓ repointed ${count}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
