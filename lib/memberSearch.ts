import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fold, SQL_FOLD_FROM, SQL_FOLD_TO } from '@/lib/turkishFold'

/**
 * Members a search box should find, by the three things the placeholder
 * promises: name, interest and club.
 *
 * Interests and clubs were never searched at all — typing "photography" or a
 * club's name returned nothing, and the client-side matching that looked like
 * it covered them only ever filtered rows the server had already narrowed by
 * name. Names also missed anything spelled with Turkish letters (see
 * lib/turkishFold).
 *
 * Only publicly-visible members are matched this way: a connections-only
 * member is findable by the start of their first name and nothing else
 * (lib/memberPrivacy nameSearchWhere), or a search could confirm the
 * interests and clubs their locked card withholds.
 */
export async function searchableMemberIds(search: string, cityId: string): Promise<string[]> {
  const folded = fold(search)
  // Three characters, counted on the term itself — the old guard measured the
  // string with its wildcards already attached, so it only ever rejected an
  // empty search and a single letter scanned the whole directory. `%` and `_`
  // are escaped: typing one of them matched everybody.
  if (folded.length < 3) return []
  const term = `%${folded.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN club_memberships cm ON cm."userId" = u.id AND cm.status = 'approved'
    LEFT JOIN clubs c ON c.id = cm."clubId" AND c."isPrivate" = false AND c."isActive" = true
    WHERE u.status = 'approved'
      AND u."hiddenFromMembers" = false
      AND u."profileVisibility" <> 'connections'
      AND u."cityId" = ${cityId}
      AND (u."suspendedUntil" IS NULL OR u."suspendedUntil" <= NOW())
      AND (
        lower(translate(u.name, ${SQL_FOLD_FROM}, ${SQL_FOLD_TO})) LIKE ${term}
        OR EXISTS (
          SELECT 1 FROM unnest(u.interests) AS i
          WHERE lower(translate(i, ${SQL_FOLD_FROM}, ${SQL_FOLD_TO})) LIKE ${term}
        )
        -- Clubs they HOST only: which rooms someone runs is public, which
        -- ones they merely belong to is a connection's to know (the same line
        -- the member list draws), and a club's roster is published nowhere.
        OR (cm.role = 'host' AND lower(translate(c.name, ${SQL_FOLD_FROM}, ${SQL_FOLD_TO})) LIKE ${term})
      )
    ORDER BY u.id
    LIMIT 500
  `)
  return rows.map(r => r.id)
}
