// One-off diagnostic: print why a member's avatar isn't loading.
//
//   npx tsx --env-file=.env scripts/diagnose-avatar.ts amir
//
// Searches users by case-insensitive name substring and prints:
//   - DB row: id, name, status, role, profilePhoto
//   - Whether the on-disk file exists (resolved from profilePhoto)
//   - Whether the URL is canonical (`/app/api/files/applications/X.jpg`)
//   - Whether the access-control gate in /api/files/[...path] would
//     return 200 for an unauthenticated request (depends on status)
//
// Read-only — never mutates anything. Safe to run against prod.

import { prisma } from '@/lib/prisma'
import { existsSync } from 'fs'
import { join } from 'path'

async function main() {
  const query = process.argv[2]
  if (!query) {
    console.log('Usage: npx tsx --env-file=.env scripts/diagnose-avatar.ts <name-substring>')
    process.exit(1)
  }

  const users = await prisma.user.findMany({
    where:  { name: { contains: query, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, status: true, role: true, profilePhoto: true },
  })

  if (users.length === 0) {
    console.log(`No users match "${query}"`)
    return
  }

  console.log(`Found ${users.length} user${users.length === 1 ? '' : 's'} matching "${query}":\n`)

  const CANONICAL = /^\/app\/api\/files\/applications\/[\w\-]+\.(jpg|jpeg|png|webp|gif)$/i

  for (const u of users) {
    console.log(`── ${u.name} <${u.email}>`)
    console.log(`   id:       ${u.id}`)
    console.log(`   status:   ${u.status}`)
    console.log(`   role:     ${u.role}`)
    console.log(`   photo DB: ${u.profilePhoto ?? '(null)'}`)

    if (!u.profilePhoto) { console.log(`   → no photo set; UI renders initials fallback\n`); continue }

    const canonical = CANONICAL.test(u.profilePhoto)
    console.log(`   canonical URL? ${canonical ? 'yes' : 'NO — legacy/malformed'}`)

    // Strip the leading /app/api/files/ or /api/files/ or /uploads/
    // and look for the file at public/uploads/<rest>
    let rel = u.profilePhoto
      .replace(/^\/app\/api\/files\//, '')
      .replace(/^\/api\/files\//,      '')
      .replace(/^\/uploads\//,         '')
    const onDisk = join(process.cwd(), 'public', 'uploads', rel)
    const exists = existsSync(onDisk)
    console.log(`   on disk:  ${onDisk}`)
    console.log(`   exists?   ${exists ? 'yes' : 'NO — file missing'}`)

    // The /api/files route gates applications/* on status='approved'
    if (rel.startsWith('applications/') && u.status !== 'approved') {
      console.log(`   ⚠ status is "${u.status}" — /api/files returns 403 to non-admins`)
    }

    // Sum up the likely cause
    const causes: string[] = []
    if (!canonical) causes.push('non-canonical URL — leaderboard <img> uses raw value, browser 404s')
    if (!exists)    causes.push('file missing on disk — server returns 404 regardless')
    if (rel.startsWith('applications/') && u.status !== 'approved') causes.push(`status="${u.status}" — file route 403s`)
    if (causes.length === 0) console.log(`   → looks healthy; problem may be client-side or rank > 10`)
    else                     console.log(`   → likely cause: ${causes.join(' + ')}`)
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
