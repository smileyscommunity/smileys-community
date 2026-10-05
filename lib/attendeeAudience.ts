// Who an "everyone going to this event / in this club" message reaches: an
// approved account. A ban keeps its seats and memberships on purpose, so a
// recipient list built from seats alone reached banned and self-deleted
// accounts. The admin broadcast, the host broadcast, "Remind attendees" and
// "Notify no-shows" each carried their own version of this filter, and they
// had drifted (one skipped banned/deleted, the rest required approved) —
// how two of them came to email banned members. One rule, read by all four.
export const MESSAGEABLE_USER = { status: 'approved' } as const
