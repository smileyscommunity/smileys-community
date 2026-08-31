// One-off: announce the Beşiktaş "Sunday Sip & Chat" event that went live
// silently (published via the full edit form, before that path fired the
// new_event notification). Uses the shared notifyNewEvent helper, so it's
// batched and idempotency-guarded — safe to run once; a second run is a no-op.
//   npx tsx --env-file=.env --env-file=.env.local scripts/announce-besiktas-event.ts
import { prisma } from '../../lib/prisma'
import { notifyNewEvent } from '../../lib/notify'

async function main() {
  const id = 'cms0b5nja000mci6fi3mbuk0o'
  const ev = await prisma.event.findUnique({
    where: { id },
    select: { id: true, title: true, clubId: true, hostId: true, status: true },
  })
  if (!ev) { console.log('Event not found'); return }
  if (ev.status !== 'published') { console.log('Event not published:', ev.status); return }

  const link = `/events/${id}`
  const before = await prisma.notification.count({ where: { type: 'new_event', link } })
  await notifyNewEvent(ev)
  const after = await prisma.notification.count({ where: { type: 'new_event', link } })
  console.log(`"${ev.title}" — new_event notifications: ${before} -> ${after}`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
