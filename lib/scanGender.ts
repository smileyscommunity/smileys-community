import { Prisma } from '@prisma/client'

// The gender the connection-abuse scans key on. Members can edit their
// profile's gender, and both scans read it: a member flagged for spraying
// requests at women could set theirs to "female" and drop out of the flag,
// which only fires on cross-gender skew. So the scans read what the member
// said when they applied (their approved application, else their earliest),
// then the value before their first profile edit (audited as
// member.gender_changed), and only then the profile's current value — for
// accounts with neither, e.g. staff-created ones.
//
// Common-table expressions ending in `scan_gender` (id, gender), keyed on
// users.id — built as hash joins so a scan over every member stays cheap:
//   WITH ${SCAN_GENDER_CTE} SELECT … JOIN scan_gender g ON g.id = u.id
export const SCAN_GENDER_CTE = Prisma.sql`app_gender AS (
  SELECT DISTINCT ON (lower(email)) lower(email) AS email, lower(trim(gender)) AS gender
  FROM member_applications
  WHERE NULLIF(trim(gender), '') IS NOT NULL
  ORDER BY lower(email), (status = 'approved') DESC, "createdAt" ASC
), first_edit_gender AS (
  SELECT DISTINCT ON ("targetId") "targetId" AS id, lower(trim(meta->>'from')) AS gender
  FROM audit_logs
  WHERE action = 'member.gender_changed' AND NULLIF(trim(meta->>'from'), '') IS NOT NULL
  ORDER BY "targetId", "createdAt" ASC
), scan_gender AS (
  SELECT u.id, COALESCE(a.gender, e.gender, NULLIF(lower(trim(u.gender)), '')) AS gender
  FROM users u
  LEFT JOIN app_gender a ON a.email = lower(u.email)
  LEFT JOIN first_edit_gender e ON e.id = u.id
)`
