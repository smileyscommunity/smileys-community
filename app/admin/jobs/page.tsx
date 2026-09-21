'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

// The sweeper health page. The dashboard's red "stale sweepers" pill says
// THAT something is wrong; this is where you find out which one and why.
// Moved off /admin/notifications (now Broadcasts) with the Run-now block.

type JobState = 'ok' | 'stale' | 'never' | 'error'

interface Job {
  name:          string
  intervalMin:   number
  state:         JobState
  lastSuccessAt: string | null
  minutesSince:  number | null
  lastError:     string | null
  lastErrorAt:   string | null
  totalRuns:     number
  totalErrors:   number
}

interface RunnableJob {
  name:        string
  label:       string
  description: string
  endpoint:    string
}

// A failed load must never read as "no jobs" — an empty schedule and an
// unreachable API look identical otherwise, and this is the page people
// come to when they already suspect something is broken.
const LOAD_FAILED =
  "We couldn't reach the jobs API just now, so what's below may be out of date — it isn't an empty schedule."

// Problems first: a page about failures shouldn't bury them under the
// seventeen sweepers that are fine.
const STATE_ORDER: Record<JobState, number> = { error: 0, never: 1, stale: 2, ok: 3 }

// The pill carries its word as well as its colour — colour alone isn't a
// state anyone can read out loud, or see.
const STATE_PILL: Record<JobState, { label: string; className: string }> = {
  ok:    { label: 'OK',        className: 'bg-green-900/50 text-green-400' },
  stale: { label: 'Stale',     className: 'bg-amber-900/50 text-amber-400' },
  error: { label: 'Failing',   className: 'bg-red-900/50 text-red-400' },
  never: { label: 'Never run', className: 'bg-zinc-800 text-zinc-400 border border-zinc-700' },
}

// Same output style as the one on /admin/posts.
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60)   return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// crontab minutes read as English. The three cadences we actually use get
// their own word; anything else falls back to a number.
function cadenceLabel(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return 'cadence unknown'
  if (min === 60)    return 'hourly'
  if (min === 1440)  return 'daily'
  if (min === 10080) return 'weekly'
  if (min < 60)      return `every ${min} min`
  if (min % 60 === 0) return `every ${min / 60} h`
  return `every ${min} min`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The server answers `{ error }` on failure, but a gateway can answer HTML.
async function readJsonBody(res: Response): Promise<Record<string, any> | null> {
  try {
    const d = JSON.parse(await res.text())
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null
  } catch { return null }
}

export default function AdminJobsPage() {
  const [jobs,     setJobs]     = useState<Job[]>([])
  const [runnable, setRunnable] = useState<RunnableJob[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  // Keyed by job name so a second Run-now block (if one is ever added)
  // doesn't share one spinner.
  const [running,  setRunning]  = useState<string | null>(null)

  const load = useCallback(async (opts: { toastOnError?: boolean } = {}) => {
    const { toastOnError = true } = opts
    setLoading(true)
    try {
      const res  = await fetch('/app/api/admin/jobs', { credentials: 'include' })
      const data = await readJsonBody(res)
      if (!res.ok) {
        const msg = (typeof data?.error === 'string' && data.error) || 'Could not load jobs'
        if (toastOnError) toast.error(msg)
        setError(msg)
        return
      }
      setJobs(Array.isArray(data?.jobs) ? (data!.jobs as Job[]) : [])
      setRunnable(Array.isArray(data?.runnable) ? (data!.runnable as RunnableJob[]) : [])
      setError(null)
    } catch {
      const msg = 'Could not load jobs'
      if (toastOnError) toast.error(msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function runJob(job: RunnableJob) {
    setRunning(job.name)
    try {
      const res  = await fetch(job.endpoint, { method: 'POST', credentials: 'include' })
      const data = await readJsonBody(res)
      if (!res.ok) {
        toast.error(data?.error ?? `Cron failed (HTTP ${res.status})`)
        return
      }
      // Report every count the sweeper hands back, skipping the zeroes so a
      // quiet run still reads as a run.
      const lines: string[] = []
      if (data?.sent24h)          lines.push(`24h reminders: ${data.sent24h}`)
      if (data?.sent2h)           lines.push(`2h reminders: ${data.sent2h}`)
      if (data?.sentReviews)      lines.push(`Review nudges: ${data.sentReviews}`)
      if (data?.sentConnections)  lines.push(`Connection pings: ${data.sentConnections}`)
      if (data?.archivedCount)    lines.push(`Archived: ${data.archivedCount}`)
      if (data?.expiringListings) lines.push(`Expiring listings: ${data.expiringListings}`)
      if (data?.purgedPhotos)     lines.push(`Purged photos: ${data.purgedPhotos}`)
      toast.success(lines.length ? `✓ ${lines.join(' · ')}` : '✓ Nothing to send right now')
      // The run just moved this sweeper's row — show it.
      await load({ toastOnError: false })
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setRunning(null)
    }
  }

  const sorted = [...jobs].sort((a, b) =>
    (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || a.name.localeCompare(b.name),
  )
  const needAttention = jobs.filter(j => j.state !== 'ok').length
  const summary = jobs.length === 0
    ? null
    : needAttention === 0
      ? `All ${plural(jobs.length, 'job')} running on schedule.`
      : `${plural(jobs.length, 'job')} · ${needAttention} need${needAttention === 1 ? 's' : ''} attention`

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-white text-2xl font-extrabold">Jobs</h1>
          <p className="text-zinc-400 text-sm mt-1">Scheduled sweepers — what ran, what didn&apos;t, and why.</p>
          {summary && (
            <p className={`text-xs mt-1 ${needAttention > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{summary}</p>
          )}
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="shrink-0 text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <LoadErrorBanner message={error} onRetry={() => load()} title="Couldn't load jobs" />
      {error && <p className="text-zinc-500 text-xs -mt-3">{LOAD_FAILED}</p>}

      {/* Run now — only the sweeper the server says can be triggered by hand. */}
      {runnable.map(job => (
        <div key={job.name} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <h2 className="text-white font-bold mb-1">Run now</h2>
          <p className="text-zinc-500 text-xs mb-4">Everything else runs on its own schedule from the server&apos;s crontab.</p>
          <div className="flex items-start justify-between gap-4 py-3 border-t border-zinc-800">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{job.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{job.description}</p>
              <code className="text-xs text-zinc-600 mt-1 block break-all">{job.endpoint}</code>
            </div>
            <button
              onClick={() => runJob(job)}
              disabled={running === job.name}
              className="shrink-0 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {running === job.name ? 'Running…' : 'Run now'}
            </button>
          </div>
        </div>
      ))}

      {/* The list */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h2 className="text-white font-bold mb-4">Sweepers</h2>
        {loading && jobs.length === 0 ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : error && jobs.length === 0 ? null : jobs.length === 0 ? (
          <p className="text-zinc-600 text-sm italic">No sweepers are registered.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map(job => {
              const pill = STATE_PILL[job.state] ?? STATE_PILL.never
              return (
                <div key={job.name} className="py-3 border-t border-zinc-800 first:border-t-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <h3 className="font-mono text-sm text-white break-all min-w-0">{job.name}</h3>
                    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${pill.className}`}>
                      {pill.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 flex-wrap">
                    <span>{cadenceLabel(job.intervalMin)}</span>
                    <span>·</span>
                    <span>
                      Last success{' '}
                      {job.lastSuccessAt
                        ? <span className="text-zinc-400">{timeAgo(job.lastSuccessAt)}</span>
                        : <span className="text-zinc-400">never</span>}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 mt-0.5">
                    {job.totalRuns === 0 ? 'no runs recorded' : (
                      <>
                        {plural(job.totalRuns, 'run')}
                        {' · '}
                        <span className={job.totalErrors > 0 ? 'text-red-400' : undefined}>
                          {plural(job.totalErrors, 'error')}
                        </span>
                      </>
                    )}
                  </p>

                  {job.lastError && (
                    <details className="mt-2">
                      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs font-semibold text-red-400 hover:text-red-300">
                        Last error{job.lastErrorAt ? ` · ${timeAgo(job.lastErrorAt)}` : ''} — show
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-red-300/90 font-mono">
                        {job.lastError}
                      </pre>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
