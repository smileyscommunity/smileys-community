// ── What a duplicated event keeps, and what it starts fresh ─────────────────
//
// The duplicate route built the copy by spreading the source row minus a
// handful of overrides. Every column added since rode along, including the
// sweep stamps: a copy of a finished event carried noShowProcessedAt and
// surveyDispatchedAt, so the no-show sweeper skipped it as 'already_processed'
// and no survey ever went out (2 upcoming events, 2026-09 data audit).
//
// Now the copy is built from an explicit allow-list. A column that isn't in
// DUPLICATE_COPIED_FIELDS never reaches the new row, and tests/scan5Batch31
// fails when the Event model grows a column this file hasn't classified —
// so the next stamp can't slip through the same way.
//
// Pure: no prisma import (the route does the IO).

import type { Prisma, Event } from '@prisma/client'
import { normalizeClock } from '@/lib/eventTime'

/** Content the organiser chose — the point of duplicating. */
export const DUPLICATE_COPIED_FIELDS = [
  'description', 'time', 'endTime', 'duration',
  'location', 'neighborhood', 'address', 'lat', 'lng', 'businessId',
  'emoji', 'coverImage', 'coverImagePosition', 'vibes', 'intent', 'language', 'difficulty',
  'price', 'memberPrice', 'currency', 'payTo', 'paymentContact', 'ticketUrl', 'refundPolicy',
  'totalSpots', 'limitedSpots', 'approvalRequired', 'isPremium', 'membersOnly', 'isFirstTimerFriendly',
  'minAge', 'maxAge', 'genderBalance', 'maleQuota', 'femaleQuota', 'turkishMaleQuota',
  'meetingUrl', 'whatsappUrl',
  'clubId', 'hostId', 'cityId',
  // Standing: the organiser's call on the tier and the cutoff.
  'tierOverride', 'cancelCutoffHours',
] as const satisfies readonly (keyof Event)[]

/**
 * Everything else, with why it starts fresh. Ids and timestamps are Prisma's;
 * the rest are state of the SOURCE event's life, not its content.
 */
export const DUPLICATE_RESET_FIELDS = [
  'id', 'createdAt', 'updatedAt',          // Prisma regenerates
  'title',                                 // suffixed " (Copy)"
  'date',                                  // today in the event's city
  'status',                                // draft — reviewed before publishing
  'spotsLeft', 'soldOut',                  // no seats taken on a new event
  'featured',                              // a staff placement for that event
  'seriesId', 'isRecurring',               // not a phantom member of the series
  'registrationDeadline',                  // the source's deadline is already past
  'cancelledAt', 'cancelReason',           // the copy isn't cancelled
  'surveyDispatchedAt', 'surveyReminderAt', // sweep stamps: set only after
  'noShowProcessedAt',                      //   an event has happened
  'tierOverrideById', 'tierOverrideAt',     // who set the source's tier, not the copy's
] as const satisfies readonly (keyof Event)[]

type Source = Pick<Event, (typeof DUPLICATE_COPIED_FIELDS)[number] | 'title' | 'totalSpots'>

export function duplicateEventData(source: Source, today: string): Prisma.EventUncheckedCreateInput {
  const copied: Record<string, unknown> = {}
  for (const k of DUPLICATE_COPIED_FIELDS) copied[k] = source[k]
  return {
    ...(copied as Pick<Event, (typeof DUPLICATE_COPIED_FIELDS)[number]>),
    // A legacy '22.00' shouldn't be cloned into a fresh row; a start time that
    // doesn't normalise ('TBA') is kept as the organiser wrote it.
    time:                 normalizeClock(source.time, 'start') ?? source.time,
    endTime:              source.endTime ? normalizeClock(source.endTime, 'end') : null,
    title:                `${source.title} (Copy)`,
    date:                 today,
    status:               'draft',
    spotsLeft:            source.totalSpots,
    soldOut:              false,
    featured:             false,
    seriesId:             null,
    isRecurring:          false,
    registrationDeadline: null,
    cancelledAt:          null,
    cancelReason:         null,
    surveyDispatchedAt:   null,
    surveyReminderAt:     null,
    noShowProcessedAt:    null,
  }
}
