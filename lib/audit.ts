import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export function getDiff(oldObj: any, newObj: any) {
  const diff: Record<string, { from: any; to: any }> = {}
  for (const key in newObj) {
    if (newObj[key] !== oldObj[key]) {
      diff[key] = { from: oldObj[key], to: newObj[key] }
    }
  }
  return Object.keys(diff).length > 0 ? diff : null
}

// ── Which city an audit row belongs to ──────────────────────────────────────
//
// Resolved from the target rather than passed by the 96 call sites: an
// event's city, a member's home city, the city itself. Anything without a
// city (platform settings, the Cup, tags) stays null, as does anything the
// resolver can't find — an audit write must never fail because a lookup did.
// `meta.cityId`, where a caller already knows it, wins over the lookup.
//
// Keep this table in step with the targetType strings the routes use; a new
// city-bound target type that isn't listed here simply audits as city-less.
async function cityForTarget(targetType: string | undefined, targetId: string | undefined): Promise<string | null> {
  if (!targetType || !targetId) return null
  const one = <T extends { cityId: string | null } | null>(p: Promise<T>) => p.then(r => r?.cityId ?? null)
  const viaEvent = <T extends { event: { cityId: string } | null } | null>(p: Promise<T>) => p.then(r => r?.event?.cityId ?? null)
  switch (targetType) {
    case 'city':           return targetId
    case 'user':           return one(prisma.user.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'event':          return one(prisma.event.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'club':           return one(prisma.club.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'business':       return one(prisma.business.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'listing':        return one(prisma.listing.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'neighborhood':   return one(prisma.neighborhood.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'guide_entry':
    case 'guide_entry_update':
                           return one(prisma.guideEntry.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'testimonial':    return one(prisma.testimonial.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'post':           return one(prisma.post.findUnique({ where: { id: targetId }, select: { cityId: true } }))
    case 'payment':        return viaEvent(prisma.payment.findUnique({ where: { id: targetId }, select: { event: { select: { cityId: true } } } }))
    case 'no_show_card':   return viaEvent(prisma.noShowCard.findUnique({ where: { id: targetId }, select: { event: { select: { cityId: true } } } }))
    case 'business_claim': return prisma.businessClaim.findUnique({ where: { id: targetId }, select: { business: { select: { cityId: true } } } })
                                 .then(r => r?.business?.cityId ?? null)
    case 'report':         return prisma.report.findUnique({ where: { id: targetId }, select: { reported: { select: { cityId: true } } } })
                                 .then(r => r?.reported?.cityId ?? null)
    default:               return null
  }
}

// Launch and seed scripts run on the server with no session. They still
// change what members see, so they audit under this actor rather than not at
// all — the dashboard's "Recent Activity" is the audit log, and a city that
// gained 17 neighborhoods with no row there looks like nothing happened.
// adminId is a plain string (no FK), so a non-user id is safe here.
export const SCRIPT_ACTOR = { id: 'system:script', name: 'Launch script' } as const

export async function writeAudit(
  adminId: string,
  adminName: string,
  action: string,
  targetId?: string,
  targetType?: string,
  meta?: Record<string, unknown>,
  description?: string,
) {
  try {
    const metaValue: Prisma.InputJsonValue | undefined = meta ? (meta as Prisma.InputJsonValue) : undefined
    const cityId = typeof meta?.cityId === 'string'
      ? meta.cityId
      : await cityForTarget(targetType, targetId).catch(() => null)
    await prisma.auditLog.create({
      data: {
        adminId,
        adminName,
        action,
        description: description ?? null,
        targetId:   targetId   ?? null,
        targetType: targetType ?? null,
        meta: metaValue,
        cityId,
      },
    })
  } catch (e) {
    console.error('Audit log failed:', e)
  }
}
