import { Prisma } from '@prisma/client'
import { SCAN_GENDER_CTE } from '@/lib/scanGender'

// The connection/DM fan-out heuristics, in one place.
//
// These lived twice: in scripts/scan-connection-abuse.ts (the Monday email)
// and in app/api/admin/users/connection-flags (the live admin panel). The
// panel's comment claimed parity with the script and there wasn't any — the
// two had drifted into detecting different populations:
//
//   - volume:      the email flagged from 10 requests, the panel from 20, so
//                  the 10–19 band (new accounts, the profile the email's
//                  threshold was lowered to 10 to catch) was invisible in the
//                  panel;
//   - combination: the email required skew AND a volume signal, the panel
//                  fired on ANY ONE of the three, so the panel flagged plain
//                  low acceptance with no targeting pattern at all;
//   - DM fan-out:  the email scanned it, the panel had no equivalent, so the
//                  "get accepted, then work the inbox" variant only ever
//                  appeared on a Monday.
//
// Someone checking the panel and seeing nothing could not conclude all-clear.
// Now both import this, so a threshold moves in one place or not at all.

// Lifetime, not a rolling window. The scan used to rank on the last 60 days,
// which meant an offender who stopped simply disappeared: Eric Lopez, the
// case the whole scan was built for, sent his last request on 2026-07-13 and
// had aged out by September. A report you cannot look back through is not a
// record, so nothing ages out now — `lastAt` on every row is what separates
// a live spree from old history, rather than deleting the old history.
export const THRESHOLDS = {
  MIN_REQUESTS:     10,
  MIN_DM_PARTNERS:   6,
  // Acceptance and ignore are companions: targets who ignore rather than
  // decline leave requests pending, which inflates the acceptance denominator
  // and hides the sender under the acceptance test (Zabdawi/Ntamen/Khristy,
  // 2026-07-18). A heavy unanswered backlog is its own signal.
  LOW_ACCEPTANCE:   0.30,
  HIGH_IGNORE:      0.50,
  GENDER_SKEW:      0.75,
  DM_GENDER_SKEW:   0.80,
  // Small samples skew trivially; a 3-of-3 run is not a pattern.
  MIN_GENDER_KNOWN: 10,
} as const
export type Thresholds = typeof THRESHOLDS

export interface RequestRow {
  userId:    string
  name:      string
  gender:    string | null
  role:      string
  suspended: boolean
  sent:      number
  accepted:  number
  pending:   number
  toFemale:  number
  toMale:    number
  lastAt:    Date
}

export interface DmRow {
  userId:    string
  name:      string
  gender:    string | null
  suspended: boolean
  partners:  number
  toFemale:  number
  toMale:    number
  noReply:   number
  lastAt:    Date
}

// Gender is the one the member applied with (lib/scanGender), never the
// profile value they can edit — otherwise anyone flagged for spraying
// requests at women could set theirs to "female" and drop out of a test that
// only fires cross-gender.
//
// "Not the dominant gender" rather than "the other one": a requester with no
// gender, or one who chose not to say, spraying women is still caught. This
// generalises the older female-only rule, which exempted an unset gender
// outright and saw nothing when the targets were men.
function skew(toFemale: number, toMale: number, gender: string | null, min: number, bar: number) {
  const known = toFemale + toMale
  const dominant = toFemale >= toMale ? 'female' : 'male'
  const share = known === 0 ? 0 : Math.max(toFemale, toMale) / known
  return { hit: known >= min && share >= bar && gender !== dominant, dominant, known, share }
}

// A flag is a reason to look, never a reason to act: both callers are
// read-only and every sanction stays a human decision on the warn/suspend
// tools. The reasons ride along so the panel can say which test fired.
export function requestReasons(r: RequestRow, t: Thresholds = THRESHOLDS): string[] {
  // Hosts and moderators fan out legitimately. A suspended member is NOT
  // skipped: that they were caught and acted on is the record, and hiding
  // them is how the panel lost every case it had ever resolved.
  if (r.role !== 'member') return []
  const { hit } = skew(r.toFemale, r.toMale, r.gender, t.MIN_GENDER_KNOWN, t.GENDER_SKEW)
  if (!hit) return []
  // Skew alone is not enough. Requiring a volume signal with it is what keeps
  // ordinary friend-seeking (which skews, and gets accepted) out of the list.
  const reasons = [
    ...(r.accepted / r.sent <= t.LOW_ACCEPTANCE ? ['low-acceptance'] : []),
    ...(r.pending  / r.sent >= t.HIGH_IGNORE    ? ['high-ignore']    : []),
  ]
  return reasons.length ? ['gender-skew', ...reasons] : []
}

export function dmReasons(r: DmRow, t: Thresholds = THRESHOLDS): string[] {
  // Denominator is every partner, not just the gender-known ones, matching
  // the scan this came from: an unknown-gender partner is evidence against
  // the pattern, not absent evidence.
  const dominant = r.toFemale >= r.toMale ? 'female' : 'male'
  const share = r.partners === 0 ? 0 : Math.max(r.toFemale, r.toMale) / r.partners
  if (share < t.DM_GENDER_SKEW || r.gender === dominant) return []
  return r.noReply > 0 ? ['dm-skew', 'never-replied'] : ['dm-skew']
}

// Every request a member has ever sent, per requester. Declined and withdrawn rows are
// hard-DELETED (api/connections/[id]), so only pending + accepted survive and
// these counts understate the true send volume — the thresholds are set with
// that in mind.
export const requestScanSql = (minRequests: number = THRESHOLDS.MIN_REQUESTS) => Prisma.sql`
  WITH ${SCAN_GENDER_CTE}
  SELECT u.id                                                       AS "userId",
         u.name                                                     AS "name",
         ug.gender                                                  AS "gender",
         u.role                                                     AS "role",
         (u."suspendedUntil" IS NOT NULL AND u."suspendedUntil" > NOW()) AS "suspended",
         COUNT(*)::int                                              AS "sent",
         COUNT(*) FILTER (WHERE mc.status = 'accepted')::int         AS "accepted",
         COUNT(*) FILTER (WHERE mc.status = 'pending')::int          AS "pending",
         COUNT(*) FILTER (WHERE rg.gender = 'female')::int           AS "toFemale",
         COUNT(*) FILTER (WHERE rg.gender = 'male')::int             AS "toMale",
         MAX(mc."createdAt")                                         AS "lastAt"
  FROM member_connections mc
  JOIN users u ON u.id = mc."requesterId"
  JOIN scan_gender ug ON ug.id = u.id
  JOIN scan_gender rg ON rg.id = mc."receiverId"
  GROUP BY u.id, ug.gender
  HAVING COUNT(*) >= ${minRequests}
  ORDER BY COUNT(*) DESC`

// DM fan-out: many one-way threads. Requires an accepted connection to exist
// at all, so it catches the "get accepted, then work the inbox" variant the
// request scan cannot see.
export const dmScanSql = (minPartners: number = THRESHOLDS.MIN_DM_PARTNERS) => Prisma.sql`
  WITH ${SCAN_GENDER_CTE}, threads AS (
    SELECT "fromId", "toId", MAX("createdAt") AS last_at FROM direct_messages
    GROUP BY "fromId", "toId"
  )
  SELECT u.id                                                       AS "userId",
         u.name                                                     AS "name",
         ug.gender                                                  AS "gender",
         (u."suspendedUntil" IS NOT NULL AND u."suspendedUntil" > NOW()) AS "suspended",
         COUNT(*)::int                                              AS "partners",
         SUM(CASE WHEN pg.gender = 'female' THEN 1 ELSE 0 END)::int  AS "toFemale",
         SUM(CASE WHEN pg.gender = 'male'   THEN 1 ELSE 0 END)::int  AS "toMale",
         SUM(CASE WHEN rev."fromId" IS NULL THEN 1 ELSE 0 END)::int  AS "noReply",
         MAX(t.last_at)                                              AS "lastAt"
  FROM threads t
  JOIN users u ON u.id = t."fromId" AND u.role = 'member'
  JOIN scan_gender ug ON ug.id = u.id
  JOIN scan_gender pg ON pg.id = t."toId"
  LEFT JOIN threads rev ON rev."fromId" = t."toId" AND rev."toId" = t."fromId"
  GROUP BY u.id, ug.gender
  HAVING COUNT(*) >= ${minPartners}
  ORDER BY COUNT(*) DESC`

export const pct = (n: number, d: number) => d === 0 ? 0 : Math.round(100 * n / d)
