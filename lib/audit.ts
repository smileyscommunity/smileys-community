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
    await prisma.auditLog.create({
      data: {
        adminId,
        adminName,
        action,
        description: description ?? null,
        targetId:   targetId   ?? null,
        targetType: targetType ?? null,
        meta: metaValue,
      },
    })
  } catch (e) {
    console.error('Audit log failed:', e)
  }
}
