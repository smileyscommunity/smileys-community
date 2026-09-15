// ── Recurring-series creation bounds + honest outcome summary (pure) ────────
// The admin and host "Repeat" forms create a series as one POST per date to
// /api/admin/events, all sharing a client-generated seriesId. Nothing bounded
// how many (the number input's max={52} is advisory — typing 500 sent 500),
// and the loop stopped at the first failure without saying how many events
// already existed, so a retry duplicated them. Client components import this,
// so keep it free of prisma/fs.

export const MAX_SERIES_OCCURRENCES = 52
export const MIN_SERIES_OCCURRENCES = 2

// The edit pages' "Create N more" counts copies of an event that already
// exists, and the server's cap counts that source event too — so copies run
// 1..51, not 2..52.
export const MIN_SERIES_COPIES = 1
export const MAX_SERIES_COPIES = MAX_SERIES_OCCURRENCES - 1

export function clampOccurrences(n: unknown, min = MIN_SERIES_OCCURRENCES, max = MAX_SERIES_OCCURRENCES): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

export interface SeriesFailure { date: string; error: string }

/**
 * null when every date was created. Otherwise one message that states created
 * vs failed counts, which dates failed and why, and warns that re-submitting
 * the whole form would duplicate the events that did get created.
 */
export function seriesOutcomeMessage(total: number, created: number, failures: SeriesFailure[]): string | null {
  if (failures.length === 0) return null
  const reasons = failures.slice(0, 5).map(f => `${f.date}: ${f.error}`).join('; ')
  const more = failures.length > 5 ? `; +${failures.length - 5} more` : ''
  if (created === 0) {
    return total === 1 ? failures[0].error : `None of the ${total} events were created — ${reasons}${more}`
  }
  return `Created ${created} of ${total} events; ${failures.length} failed (${reasons}${more}). ` +
    `Don't submit the form again — that would duplicate the ${created} already created. Add the missing dates individually.`
}
