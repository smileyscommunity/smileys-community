import { prisma } from '@/lib/prisma'

/**
 * A city id that doesn't exist. Distinct from `null`, which is the legitimate
 * "across Smileys" value — collapsing the two would let a typo'd or stale id
 * publish a quote to every city, the failure this column was added to end.
 */
export const INVALID = Symbol('invalid-city')

/**
 * Normalises the `cityId` an admin form sends into `string | null`, or INVALID.
 *
 * Absent and empty-string both mean "across Smileys": the form submits `''`
 * for its no-city option, and callers that never mention cityId shouldn't be
 * forced to.
 */
export async function resolveCityIdInput(
  raw: unknown,
): Promise<string | null | typeof INVALID> {
  if (raw === undefined || raw === null || raw === '') return null

  const id = String(raw).trim()
  if (!id) return null

  const city = await prisma.city.findUnique({ where: { id }, select: { id: true } })
  return city ? city.id : INVALID
}
