// Set the structured event facts on an article (Post.eventDetails), which the
// article page renders as the "Event details" card. PUBLIC facts only — never
// a private discount link or code (use set-post-member-offer.ts for those).
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/set-post-event-details.ts <slug> '<json>'
//
// json keys: eventDate (YYYY-MM-DD), startTime (HH:MM), timeConfirmed (bool),
// venue, district, language, subtitles, ticketUrl (https), transport, benefit.
// Omit what you have not verified — nothing is inferred. CLEAR=1 removes it.
import { prisma } from '@/lib/prisma'
import { parseEventDetails } from '@/lib/postEventDetails'

async function main() {
  const [slug, json] = process.argv.slice(2)
  if (!slug) throw new Error('usage: set-post-event-details.ts <slug> \'<json>\'  (CLEAR=1 to remove)')
  const post = await prisma.post.findUnique({ where: { slug }, select: { id: true, title: true, body: true, eventDetails: true, memberOffer: true } })
  if (!post) throw new Error(`no post with slug ${slug}`)

  const next = process.env.CLEAR === '1' ? null : parseEventDetails(JSON.parse(json ?? 'null'))
  if (process.env.CLEAR !== '1' && !next) throw new Error('no valid fields in the JSON (a field that fails validation is dropped)')

  // A public card must never carry the restricted offer.
  const o = post.memberOffer
  const blob = JSON.stringify(next ?? {})
  for (const secret of [o?.url, o?.code]) if (secret && blob.includes(secret)) throw new Error('eventDetails contains the private member offer — refusing')

  console.log(`${post.title}\n  before: ${JSON.stringify(post.eventDetails)}\n  after:  ${JSON.stringify(next)}`)
  if (process.env.DRY_RUN === '1') return console.log('DRY_RUN — nothing written')
  await prisma.$executeRaw`UPDATE "posts" SET "eventDetails" = ${next === null ? null : JSON.stringify(next)}::jsonb WHERE id = ${post.id}`
  console.log('written. The article page caches for up to 5 minutes.')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
