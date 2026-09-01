// Make sure a city's clubs actually have a host.
//
// Every city launches with a set of clubs, but a club with no approved host
// is a club nobody can run an event in — and the maturity model needs at
// least one hosted club before a city can leave the seeding stage. Antalya
// launched with three active clubs and zero hosts, which is what this exists
// to catch and fix.
//
// Idempotent: an existing membership is promoted to host rather than
// duplicated, and `memberCount` is incremented only when a row is actually
// created (the column counts approved memberships INCLUDING hosts — verified
// against every live city before this was written).
//
// Usage — dry run first, always:
//   CITY=antalya HOST_EMAIL=nate@smileyscommunity.com \
//     npx tsx --env-file=.env --env-file=.env.local scripts/ensure-city-host.ts
//   … APPLY=1 …    to write
//
// CLUBS=social-antalya,newcomers-antalya limits it to named slugs; the
// default is every ACTIVE club in the city.

import { prisma } from '@/lib/prisma'

const CITY       = process.env.CITY
const HOST_EMAIL = process.env.HOST_EMAIL
const APPLY      = process.env.APPLY === '1'
const ONLY_CLUBS = process.env.CLUBS?.split(',').map(s => s.trim()).filter(Boolean) ?? null

async function main() {
  if (!CITY || !HOST_EMAIL) throw new Error('CITY and HOST_EMAIL are required')

  const [city, host] = await Promise.all([
    prisma.city.findUnique({ where: { slug: CITY }, select: { id: true, name: true } }),
    prisma.user.findUnique({ where: { email: HOST_EMAIL }, select: { id: true, name: true, status: true } }),
  ])
  if (!city) throw new Error(`No city with slug "${CITY}"`)
  if (!host) throw new Error(`No user with email "${HOST_EMAIL}"`)
  if (host.status !== 'approved') throw new Error(`${host.name} is not approved (${host.status})`)

  const clubs = await prisma.club.findMany({
    where:   { cityId: city.id, isActive: true, ...(ONLY_CLUBS ? { slug: { in: ONLY_CLUBS } } : {}) },
    orderBy: { slug: 'asc' },
    select:  { id: true, slug: true, name: true, memberCount: true },
  })
  if (!clubs.length) throw new Error(`No active clubs matched in ${city.name}`)

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${host.name} as host of ${clubs.length} active club(s) in ${city.name}\n`)

  let created = 0, promoted = 0, unchanged = 0
  for (const club of clubs) {
    const existing = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: host.id, clubId: club.id } },
      select: { id: true, role: true, status: true },
    })

    if (existing?.role === 'host' && existing.status === 'approved') {
      console.log(`  = ${club.slug.padEnd(26)} already hosted`)
      unchanged++
      continue
    }

    if (existing) {
      // Already a member — promote in place. memberCount already counts them,
      // so it must NOT move.
      console.log(`  ↑ ${club.slug.padEnd(26)} promote ${existing.role}/${existing.status} → host/approved (count stays ${club.memberCount})`)
      promoted++
      if (APPLY) {
        await prisma.clubMembership.update({
          where: { userId_clubId: { userId: host.id, clubId: club.id } },
          data:  { role: 'host', status: 'approved' },
        })
      }
      continue
    }

    console.log(`  + ${club.slug.padEnd(26)} add host membership (count ${club.memberCount} → ${club.memberCount + 1})`)
    created++
    if (APPLY) {
      // One transaction so a membership can never exist without its count,
      // matching how the approvals route enrols members.
      await prisma.$transaction([
        prisma.clubMembership.create({
          data: { userId: host.id, clubId: club.id, role: 'host', status: 'approved' },
        }),
        prisma.club.update({ where: { id: club.id }, data: { memberCount: { increment: 1 } } }),
      ])
    }
  }

  console.log(`\n${APPLY ? '✓ Applied' : '✓ Dry run — nothing written'}: ` +
              `${created} added, ${promoted} promoted, ${unchanged} already hosted`)
  if (!APPLY) console.log('  Re-run with APPLY=1 to write.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
