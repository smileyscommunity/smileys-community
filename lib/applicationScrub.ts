// What erasing a member does to their MemberApplication row(s). Shared by the
// self-deletion route and scripts/scrub-deleted-member-applications.ts so the
// live path and the backfill can never scrub different field sets.
//
// The row stays (approval/rejection stats by city and date still count it) but
// nothing on it identifies the person: name, contact, socials, photo, every
// free-text answer, device/network fingerprints and the demographic answers
// that re-identify in combination. Kept: city/targetCityId, status, source,
// dates, reviewer, option-set answers (interests, lookingFor, …), referral
// code of the REFERRER, and the vetting flags — none of them is about who the
// applicant was.

export const DELETED_APPLICANT_NAME = 'Deleted member'

// Self-deletion rewrites the user's email to `deleted_<hex>@deleted.smileys`;
// the application takes the SAME address so the row stays linked to the
// tombstone user (and can be recognised as scrubbed) without routing anywhere.
export const TOMBSTONE_EMAIL_SUFFIX = '@deleted.smileys'

export function isTombstoneEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(TOMBSTONE_EMAIL_SUFFIX)
}

// Nullable columns that hold PII or the applicant's own words.
export const APPLICATION_PII_NULLABLE_FIELDS = [
  'phone', 'bio', 'instagram', 'linkedin', 'profilePhoto', 'profession',
  'reasonHere', 'timeInCity', 'enjoyWith', 'goodCommunity', 'whyJoin',
  'contribution', 'groupBehavior', 'removedFromCommunity', 'toxicBehavior',
  'aboutCommunity', 'socialJudgment', 'referrerName',
  'neighborhood', 'country', 'birthdate', 'gender', 'timezone',
  'ipAddress', 'userAgent', 'fingerprint',
  // Staff free text written ABOUT the applicant — as identifying as the answers.
  'reviewNote', 'suggestion', 'escalatedNote',
] as const

export type ApplicationPiiField =
  | 'fullName' | 'firstName' | 'lastName' | 'email'
  | typeof APPLICATION_PII_NULLABLE_FIELDS[number]

export function applicationScrubData(tombstoneEmail: string) {
  const nulls = Object.fromEntries(APPLICATION_PII_NULLABLE_FIELDS.map(f => [f, null])) as
    Record<typeof APPLICATION_PII_NULLABLE_FIELDS[number], null>
  return {
    ...nulls,
    fullName:       DELETED_APPLICANT_NAME,
    firstName:      'Deleted',
    lastName:       'member',
    email:          tombstoneEmail,
    emailMarketing: false,
  }
}

export type ApplicationPiiRow = { email: string; fullName: string; firstName: string; lastName: string } &
  Partial<Record<typeof APPLICATION_PII_NULLABLE_FIELDS[number], string | null>>

// Names (never values) of the fields on a row that still hold PII.
export function applicationPiiFields(row: ApplicationPiiRow): ApplicationPiiField[] {
  const out: ApplicationPiiField[] = []
  if (row.fullName && row.fullName !== DELETED_APPLICANT_NAME) out.push('fullName')
  if (row.firstName && row.firstName !== 'Deleted') out.push('firstName')
  if (row.lastName && row.lastName !== 'member') out.push('lastName')
  if (!isTombstoneEmail(row.email)) out.push('email')
  for (const f of APPLICATION_PII_NULLABLE_FIELDS) {
    const v = row[f]
    if (typeof v === 'string' && v.trim() !== '') out.push(f)
  }
  return out
}
