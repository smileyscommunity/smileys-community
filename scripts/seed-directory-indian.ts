// One-off seed: five Indian restaurants for the business directory.
//
// Run once (locally with DATABASE_URL pointed at prod, or via ssh on
// the server: `cd /root/smileys-community && npx tsx scripts/seed-directory-indian.ts`).
// Idempotent on `name` — the script skips any row whose name already
// exists, so re-running is safe.
//
// These entries are seeded based on widely known Istanbul Indian
// restaurants. Specific details (exact address, phone, current hours)
// vary and should be verified by an admin before promoting publicly —
// the script leaves phone/address blank when unsure so an admin can
// fill them in via /admin/directory.
//
// Audit notes:
//   - submittedBy + reviewedBy are set to the first admin user found.
//     If you want a specific admin to "own" the seed, edit ADMIN_EMAIL
//     below before running.
//   - isApproved=true + isActive=true so entries appear in the
//     directory immediately.
//   - writeAudit is intentionally NOT called — this is one-off seed
//     data, not a runtime admin action.

import { prisma } from '@/lib/prisma'
import { getDefaultCityId } from '@/lib/city'

// Override to pin a specific admin as the submitter. Leave empty to
// pick the first admin the script finds.
const ADMIN_EMAIL = ''

const ENTRIES: {
  name: string
  description: string
  neighborhood: string | null
  languages?: string | null
  isExpatFriendly?: boolean
  isExpatOwned?: boolean
}[] = [
  {
    name: 'Dubb Indian Restaurant',
    description:
      'Long-running Indian spot in Sultanahmet known for tandoori dishes, biryanis and a rooftop terrace with Hagia Sophia views. A common first stop for visiting expats craving North Indian comfort food.',
    neighborhood: 'Sultanahmet',
    languages: 'English, Turkish, Hindi',
    isExpatFriendly: true,
  },
  {
    name: 'Musafir Indian Restaurant',
    description:
      'Authentic North Indian cuisine on Sıraselviler Caddesi. Curries, biryani and naan fresh from the tandoor — popular with Cihangir locals and the digital-nomad crowd nearby.',
    neighborhood: 'Cihangir',
    languages: 'English, Turkish, Hindi',
    isExpatFriendly: true,
  },
  {
    name: 'Indiana Indian Restaurant',
    description:
      'Casual Indian kitchen in Beyoğlu serving classics — butter chicken, palak paneer, lamb rogan josh. English-speaking staff and a vegetarian-friendly menu.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish',
    isExpatFriendly: true,
  },
  {
    name: 'Khorasani Indian Cuisine',
    description:
      'Family-run Indian-Pakistani restaurant near Aksaray with a loyal South Asian following. Strong on biryani, kebabs and lassi; halal kitchen.',
    neighborhood: 'Fatih',
    languages: 'English, Turkish, Urdu, Hindi',
    isExpatFriendly: true,
  },
  {
    name: 'Bombay Brasserie Istanbul',
    description:
      'Asian-side option for North Indian food — tandoori specialities, vegetarian thali and weekend lunch sets. A reliable Kadıköy choice when the line at Musafir runs long.',
    neighborhood: 'Kadıköy',
    languages: 'English, Turkish, Hindi',
    isExpatFriendly: true,
  },
]

async function main() {
  const admin = ADMIN_EMAIL
    ? await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true, name: true, email: true } })
    : await prisma.user.findFirst({
        where:  { role: 'admin' },
        select: { id: true, name: true, email: true },
      })
  if (!admin) {
    console.error('✗ No admin user found. Set ADMIN_EMAIL or create an admin first.')
    process.exit(1)
  }
  console.log(`→ Seeding as ${admin.name} <${admin.email}>`)

  // Every business carries a city (multi-city phase 1). These seeds are all
  // Istanbul venues, so the default city is the right one.
  const cityId = await getDefaultCityId()

  let created = 0
  let skipped = 0
  for (const e of ENTRIES) {
    const exists = await prisma.business.findFirst({ where: { name: e.name } })
    if (exists) {
      console.log(`· Skipping "${e.name}" (already exists)`)
      skipped++
      continue
    }
    await prisma.business.create({
      data: {
        cityId,
        name:            e.name,
        category:        'Restaurant',
        description:     e.description,
        neighborhood:    e.neighborhood,
        languages:       e.languages ?? null,
        isExpatOwned:    !!e.isExpatOwned,
        isExpatFriendly: !!e.isExpatFriendly,
        submittedById:   admin.id,
        reviewedById:    admin.id,
        reviewedAt:      new Date(),
        isApproved:      true,
        isActive:        true,
      },
    })
    console.log(`✓ Added "${e.name}" (${e.neighborhood ?? '—'})`)
    created++
  }

  console.log(`\nDone. ${created} added, ${skipped} skipped.`)
  console.log('Verify entries at /admin/directory?status=approved before broadly promoting them.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
