import { prisma } from './prisma'
import { sendCityLaunchEmail } from './email'
import { createNotification } from './notify'

// Launch day. The interest list's whole purpose is this moment: when an
// admin flips a city to live, everyone who said "tell me when it opens"
// gets told — email + in-app bell. Interest rows stay 'interested' until
// the member joins (their click, not ours); notifiedAt is the dedupe
// guard so a live → paused → live flip can't email anyone twice.
export async function notifyCityLaunch(cityId: string): Promise<{ notified: number; failed: number }> {
  const city = await prisma.city.findUnique({
    where:  { id: cityId },
    select: { name: true, slug: true },
  })
  if (!city) return { notified: 0, failed: 0 }

  const waiting = await prisma.cityRelationship.findMany({
    where: {
      cityId,
      type:       'interested',
      notifiedAt: null,
      // Suspended/banned members don't get launch mail; their interest row
      // survives, so a reinstated member is still on the list next launch.
      user: { status: 'approved' },
    },
    select: { id: true, user: { select: { id: true, name: true, email: true } } },
  })

  let notified = 0
  let failed   = 0
  // Sequential on purpose: lists are small (single digits today), Resend
  // rate-limits bursts, and one bad address must not take down the rest.
  for (const row of waiting) {
    try {
      await sendCityLaunchEmail(row.user.email, row.user.name, city.name, city.slug)
      await createNotification(
        row.user.id,
        'city_launch',
        `Smileys ${city.name} is open 🎉`,
        `You asked to be told when ${city.name} launches — one tap to join.`,
        `/${city.slug}`,
      )
      await prisma.cityRelationship.update({ where: { id: row.id }, data: { notifiedAt: new Date() } })
      notified++
    } catch (e) {
      failed++
      console.error(`[city-launch] failed to notify ${row.user.id} for ${city.slug}`, e)
    }
  }

  return { notified, failed }
}
