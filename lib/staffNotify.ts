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
  // Ids this alert must never reach, whatever role they hold — the member it
  // is about, and the member who raised it. A moderator who gets reported
  // cannot see that report in the queue (it is filtered out of their view on
  // purpose, because the reporter was promised anonymity from a host who may
  // also hold the role) and a notification naming both of them undoes that.
  except: readonly (string | null | undefined)[] = [],
): Promise<void> {
  const excluded = new Set(except.filter((id): id is string => !!id))
  const staff = await prisma.user.findMany({
    where: {
      status: 'approved',
      OR: [{ role: 'admin' }, { role: 'moderator', ...(cityId ? { cityId } : {}) }],
      ...(excluded.size ? { id: { notIn: [...excluded] } } : {}),
    },
    select: { id: true },
  })
  await Promise.all(staff.map(s => createNotification(s.id, type, title, body, link).catch(() => false)))
}
