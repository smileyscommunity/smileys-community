import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'

/**
 * Tell the staff who can act on something in a city: every admin, and the
 * moderators OF THAT CITY (a moderator's queue shows only their city, so an
 * alert from elsewhere was noise they could not act on). A global item
 * (cityId null) goes to admins and every moderator, as before.
 */
export async function notifyCityStaff(
  cityId: string | null,
  type: string, title: string, body: string, link: string,
): Promise<void> {
  const staff = await prisma.user.findMany({
    where: {
      status: 'approved',
      OR: [{ role: 'admin' }, { role: 'moderator', ...(cityId ? { cityId } : {}) }],
    },
    select: { id: true },
  })
  await Promise.all(staff.map(s => createNotification(s.id, type, title, body, link).catch(() => false)))
}
