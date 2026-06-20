// One-off: publish all existing event reviews to their club walls.
// Does NOT send notifications (backfill only).
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const { config } = require('dotenv')
config()

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const reviews = await prisma.review.findMany({
  include: {
    event: { select: { id: true, title: true, clubId: true } },
    user:  { select: { id: true, name: true } },
  },
  orderBy: { createdAt: 'asc' },
})

const eligible = reviews.filter(r => r.event.clubId)
console.log(`Found ${reviews.length} reviews total, ${eligible.length} with a club.`)

let created = 0
for (const r of eligible) {
  const stars = '⭐'.repeat(r.rating)
  const content = r.text?.trim()
    ? `${stars} "${r.event.title}"\n\n${r.text.trim()}`
    : `${stars} Just attended "${r.event.title}"`

  await prisma.clubPost.create({
    data: {
      clubId:    r.event.clubId,
      userId:    r.userId,
      content,
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    },
  })
  created++
  console.log(`  [${created}/${eligible.length}] ${r.user.name} → ${r.event.title}`)
}

console.log(`\nDone. Created ${created} club wall posts.`)
await prisma.$disconnect()
