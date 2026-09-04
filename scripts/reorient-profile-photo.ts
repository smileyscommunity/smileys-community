import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, basename } from 'path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { uploadRoot } from '@/lib/uploadRoot'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'

// Rotate a member's profile photo that was stored the wrong way up.
//
// Why this exists rather than "just rotate the file": the client downscale
// (lib/image-resize.ts) re-encodes through a canvas, which STRIPS the EXIF
// Orientation tag. In a browser that doesn't apply that tag when decoding,
// the wrong-way-up pixels get baked in, and the upload route's sharp
// .rotate() — which reads EXIF — then has nothing to correct. The photo is
// stored genuinely upside down, and no serve-time fix can know it.
//
// The root cause is fixed in lib/image-resize.ts (orientation is now read
// and applied explicitly). This repairs the photos uploaded before that.
//
// It writes a NEW file rather than rotating in place, because the file route
// serves `public, max-age=7d, immutable`: an in-place fix keeps showing the
// old image to everyone who has already loaded it, for a week, with no
// revalidation. A new filename is a new URL, so the correction is instant.
// The original is left on disk — untouched evidence if the rotation was
// wrong, and cheap.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/reorient-profile-photo.ts <userId|email> [180|90|270]
//   ...review, then rerun without DRY_RUN=1.
//
// Angle is clockwise and defaults to 180 (upside down), the case the canvas
// path produces from an EXIF Orientation 3 photo.

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const [who, angleArg] = process.argv.slice(2)
  if (!who) {
    console.error('Usage: [DRY_RUN=1] tsx scripts/reorient-profile-photo.ts <userId|email> [180|90|270]')
    process.exit(1)
  }
  const angle = Number(angleArg ?? 180)
  if (![90, 180, 270].includes(angle)) {
    console.error(`Angle must be 90, 180 or 270 (clockwise) — got ${angleArg}`)
    process.exit(1)
  }

  const user = await prisma.user.findFirst({
    where:  who.includes('@') ? { email: who.toLowerCase().trim() } : { id: who },
    select: { id: true, name: true, email: true, profilePhoto: true },
  })
  if (!user)              { console.error(`No user matching ${who}`); process.exit(1) }
  if (!user.profilePhoto) { console.error(`${user.name} has no profile photo`); process.exit(1) }

  // Stored as the public URL (/app/api/files/users/<file>); the bytes live
  // under uploadRoot()/users/<file>.
  const m = /\/api\/files\/([a-z]+)\/([^/?#]+)$/.exec(user.profilePhoto)
  if (!m) { console.error(`Unrecognised photo URL: ${user.profilePhoto}`); process.exit(1) }
  const [, folder, filename] = m
  const srcPath = join(uploadRoot(), folder, filename)
  if (!existsSync(srcPath)) { console.error(`File missing on disk: ${srcPath}`); process.exit(1) }

  const raw  = readFileSync(srcPath)
  const meta = await sharp(raw).metadata()
  // A file that still carries an Orientation tag is a different bug — the
  // upload route should have baked it in. Rotating on top of it would
  // double-apply once something finally honours the tag.
  if (meta.orientation && meta.orientation !== 1) {
    console.error(`${filename} still has EXIF Orientation ${meta.orientation} — fix the upload path, don't rotate here`)
    process.exit(1)
  }

  const out      = `${Date.now()}-${basename(filename, '.jpg').split('-').pop()}-r${angle}.jpg`
  const outPath  = join(uploadRoot(), folder, out)
  const newUrl   = `/app/api/files/${folder}/${out}`

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}${user.name} <${user.email}>`)
  console.log(`  from ${user.profilePhoto}  (${meta.width}×${meta.height})`)
  console.log(`  to   ${newUrl}  (rotated ${angle}° clockwise)`)
  if (DRY_RUN) { console.log('\n[DRY RUN] nothing written'); return }

  const rotated = await sharp(raw).rotate(angle).jpeg({ quality: 90 }).toBuffer()
  writeFileSync(outPath, rotated)

  // Guarded on the URL we read, so a concurrent change by the member wins
  // rather than being clobbered by a stale rotation.
  const res = await prisma.user.updateMany({
    where: { id: user.id, profilePhoto: user.profilePhoto },
    data:  { profilePhoto: newUrl },
  })
  if (res.count === 0) {
    console.error('  ✗ photo changed under us — new file written but the row was left alone')
    process.exit(1)
  }

  await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, 'user.photo_reorient', user.id, 'user',
    { from: user.profilePhoto, to: newUrl, angle },
    `Rotated ${user.name}'s profile photo ${angle}°`,
  )
  console.log(`\n✓ ${user.name}'s photo rotated ${angle}° — original left at ${filename}`)
}

main().finally(() => prisma.$disconnect())
