import { prisma } from '@/lib/prisma'

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const events = await prisma.event.findMany({
    where: { status: { in: ['published', 'cancelled'] } },
    select: {
      id: true,
      title: true,
      totalSpots: true,
      spotsLeft: true,
      hostId: true,
      cohosts: { select: { userId: true } },
      _count: { select: { attendees: { where: { status: 'approved' } } } },
    },
  })

  let updated = 0
  for (const e of events) {
    const excludedIds = [e.hostId, ...e.cohosts.map((c: { userId: string }) => c.userId)]
    const nonHostAttendees = await prisma.eventAttendee.count({
      where: { eventId: e.id, status: 'approved', userId: { notIn: excludedIds } },
    })
    const correct = Math.max(0, e.totalSpots - nonHostAttendees)
    if (correct !== e.spotsLeft) {
      await prisma.event.update({ where: { id: e.id }, data: { spotsLeft: correct } })
      console.log(`Fixed: ${e.title} — was ${e.spotsLeft}, now ${correct}`)
      updated++
    }
  }
  console.log(`Done. Fixed ${updated} of ${events.length} events.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
