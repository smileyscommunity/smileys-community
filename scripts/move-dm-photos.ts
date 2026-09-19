// Photos sent in direct messages before 2026-09-20 landed in uploads/general,
// which app/api/files serves to anyone holding the URL, cached publicly for a
// week. New ones go to uploads/messages, where the route checks the requester
// is one of the two people in that conversation. This moves the old ones
// across so the same rule covers them.
//
//   DRY_RUN=1 npx tsx --env-file=.env scripts/move-dm-photos.ts   # plan only
//            npx tsx --env-file=.env scripts/move-dm-photos.ts   # do it
//
// Safe to re-run: each row is updated only while it still holds the exact URL
// the plan read, and a file already moved is left alone. The message row is
// updated only after its file is in place, so a crash mid-run leaves rows
// pointing at files that still exist.
import { rename, access, mkdir } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { uploadRoot } from '@/lib/uploadRoot'

const DRY_RUN = process.env.DRY_RUN === '1'
const FILE_RE = /^\/app\/api\/files\/([a-zA-Z0-9-]+)\/([\w-]+\.(?:jpg|jpeg|png|webp|gif))$/

async function main() {
  const rows = await prisma.directMessage.findMany({
    where:  { imageUrl: { not: null }, NOT: { imageUrl: { startsWith: '/app/api/files/messages/' } } },
    select: { id: true, imageUrl: true },
  })
  console.log(`${rows.length} message photo(s) outside uploads/messages${DRY_RUN ? ' (DRY RUN)' : ''}`)

  const root = uploadRoot()
  if (!DRY_RUN) await mkdir(join(root, 'messages'), { recursive: true })

  let moved = 0, skipped = 0
  for (const row of rows) {
    const m = row.imageUrl!.match(FILE_RE)
    if (!m) { console.log(`  skip ${row.id}: unrecognised URL shape`); skipped++; continue }
    const [, folder, file] = m
    const from = join(root, folder, file)
    const to   = join(root, 'messages', file)
    const next = `/app/api/files/messages/${file}`

    const hasSource = await access(from).then(() => true).catch(() => false)
    const hasTarget = await access(to).then(() => true).catch(() => false)
    if (!hasSource && !hasTarget) { console.log(`  skip ${row.id}: ${folder}/${file} is not on disk`); skipped++; continue }

    console.log(`  ${folder}/${file} → messages/${file}`)
    if (DRY_RUN) { moved++; continue }

    if (hasSource && !hasTarget) await rename(from, to)
    // Guarded on the value just read: another run (or an edit) that already
    // moved this row must not be overwritten.
    const { count } = await prisma.directMessage.updateMany({
      where: { id: row.id, imageUrl: row.imageUrl },
      data:  { imageUrl: next },
    })
    if (count === 1) moved++
    else { console.log(`  note ${row.id}: row changed under us, file is in place`); skipped++ }
  }

  console.log(`${DRY_RUN ? 'would move' : 'moved'} ${moved}, skipped ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
