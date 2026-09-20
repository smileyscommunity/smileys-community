'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { getInitials } from '@/lib/data'
import { CityBadge, useAdminCities } from '@/components/admin/CitySelect'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

// Abuse signals, on their own page rather than buried at the top of the
// member roster. Lifetime: an offender who stopped still has a record, which
// is the point — on the old 60-day window the July 2026 case the scan was
// built for had aged out of its own report.
//
// Read-only. Every sanction stays a human decision on the warn/suspend tools.

interface Base {
  id: string
  name: string
  email: string
  role: string
  color: string
  status: string
  warningCount: number
  suspendedUntil: string | null
  suspended: boolean
  lastAt: string
  reasons: string[]
  city?: { name: string; slug: string } | null
}
interface RequestFlag extends Base { sent: number; accepted: number; pending: number; toFemale: number; toMale: number }
interface DmFlag      extends Base { partners: number; toFemale: number; toMale: number; noReply: number }

const pct = (n: number, d: number) => d === 0 ? 0 : Math.round(100 * n / d)
const day = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const daysAgo = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000)

// The four measures the detector actually uses, so a comparison is a
// comparison of the evidence and not of an invented score. Higher is worse
// on every one, which is what makes "worse on N of 4" meaningful.
function measures(f: RequestFlag) {
  return {
    'requests sent':  f.sent,
    'gender skew':    pct(Math.max(f.toFemale, f.toMale), f.toFemale + f.toMale || 1),
    'not accepted':   100 - pct(f.accepted, f.sent),
    'left ignored':   pct(f.pending, f.sent),
  }
}

function Chip({ tone = 'rose', children }: { tone?: 'rose' | 'orange' | 'zinc' | 'red'; children: React.ReactNode }) {
  const tones = {
    rose:   'bg-rose-500/10 text-rose-400 border-rose-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    zinc:   'bg-zinc-800 text-zinc-400 border-zinc-700',
    red:    'bg-red-500/10 text-red-400 border-red-500/20',
  }
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>
}

export default function AdminAbusePage() {
  const [requests, setRequests] = useState<RequestFlag[]>([])
  const [dms,      setDms]      = useState<DmFlag[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)
  // Whose record everyone else is read against. Defaults to the heaviest
  // sender, which is a fact about the data rather than a name in the source.
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const cities = useAdminCities()

  useEffect(() => {
    setError(null)
    fetch('/app/api/admin/abuse', { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this report.' : 'Could not load the report.')
        return r.json()
      })
      .then(d => {
        setRequests(Array.isArray(d.requests) ? d.requests : [])
        setDms(Array.isArray(d.dms) ? d.dms : [])
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [tick])

  const baseline = useMemo(
    () => requests.find(r => r.id === baselineId) ?? requests[0] ?? null,
    [requests, baselineId],
  )
  const baseMeasures = baseline ? measures(baseline) : null

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Abuse signals</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Members whose outbound requests or messages look like directory-trawling rather than networking.
          Counted over their whole time here, so a case stays on the record after it stops.
        </p>
      </div>

      {error && <LoadErrorBanner message={error} onRetry={() => { setLoading(true); setTick(t => t + 1) }} title="Couldn't load abuse signals" />}

      {!error && requests.length === 0 && dms.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center">
          <p className="text-sm text-zinc-400 font-semibold">Nothing flagged.</p>
          <p className="text-xs text-zinc-600 mt-1">No member crosses the thresholds on requests or messages.</p>
        </div>
      )}

      {/* How to read it. Both caveats change what a flag means, so they sit
          above the lists rather than in a tooltip nobody opens. */}
      {(requests.length > 0 || dms.length > 0) && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-xs text-zinc-500 space-y-1.5">
          <p><span className="text-zinc-300 font-semibold">These counts understate.</span> Declined and withdrawn requests are deleted, so &ldquo;10 sent&rdquo; means at least 10.</p>
          <p><span className="text-zinc-300 font-semibold">Gender is from the application</span>, not the editable profile — otherwise anyone flagged could edit their way out. A misclick on /apply persists, so open the profile before acting.</p>
          <p><span className="text-zinc-300 font-semibold">A flag is a reason to look</span>, never a reason to act. Nothing here happens automatically.</p>
        </div>
      )}

      {/* Compare-to picker. "Worse on N of 4" is only honest if the four are
          the detector's own measures, so that is exactly what it counts. */}
      {requests.length > 1 && baseline && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 flex flex-wrap items-center gap-2">
          <label htmlFor="baseline" className="text-xs text-zinc-400 font-semibold">Compare everyone against</label>
          <select
            id="baseline"
            value={baseline.id}
            onChange={e => setBaselineId(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            {requests.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="text-xs text-zinc-600">
            {Object.entries(baseMeasures!).map(([k, v]) => `${k} ${v}${k === 'requests sent' ? '' : '%'}`).join(' · ')}
          </span>
        </div>
      )}

      {requests.length > 0 && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-rose-300 flex items-center gap-2">
              Connection requests
              <Chip>{requests.length}</Chip>
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">Heavy one-sided fan-out: skewed to one gender, and either rarely accepted or mostly left unanswered.</p>
          </div>
          <div className="divide-y divide-rose-500/10">
            {requests.map(f => {
              const m = measures(f)
              const worse = baseMeasures && baseline && f.id !== baseline.id
                ? (Object.keys(m) as (keyof typeof m)[]).filter(k => m[k] > baseMeasures[k])
                : null
              const skewWho = f.toFemale >= f.toMale ? 'women' : 'men'
              const quiet = daysAgo(f.lastAt) > 60
              return (
                <div key={f.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                  <Link href={`/admin/users/${f.id}`} className="shrink-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: f.color }}>{getInitials(f.name)}</div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/admin/users/${f.id}`} className="font-semibold text-sm text-white truncate hover:text-amber-400 transition-colors">{f.name}</Link>
                      <CityBadge city={f.city} cities={cities} />
                      {baseline?.id === f.id && <Chip tone="zinc">baseline</Chip>}
                      <Chip>{m['gender skew']}% to {skewWho}</Chip>
                      {f.reasons.includes('low-acceptance') && <Chip tone="orange">{100 - m['not accepted']}% accepted</Chip>}
                      {f.reasons.includes('high-ignore') && <Chip tone="orange">{m['left ignored']}% ignored</Chip>}
                      {f.suspended && <Chip tone="red">suspended</Chip>}
                      {f.status === 'banned' && <Chip tone="red">banned</Chip>}
                      {f.warningCount > 0 && <Chip tone="orange">⚠ {f.warningCount}</Chip>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {f.sent} requests · {f.accepted} accepted · {f.pending} still pending · last {day(f.lastAt)}
                      {quiet && <span className="text-zinc-600"> (quiet since)</span>}
                    </div>
                    {worse && (
                      <div className="text-[11px] mt-0.5">
                        {worse.length === 0
                          ? <span className="text-zinc-600">Not worse than {baseline!.name} on any measure</span>
                          : <span className="text-rose-400">Worse than {baseline!.name} on {worse.length} of 4: {worse.join(', ')}</span>}
                      </div>
                    )}
                  </div>
                  <Link href={`/admin/users/${f.id}`} className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
                    Review
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {dms.length > 0 && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-rose-300 flex items-center gap-2">
              Direct messages
              <Chip>{dms.length}</Chip>
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Messaged many different people with heavy gender skew. Needs an accepted connection to exist at all, so this catches the &ldquo;get accepted, then work the inbox&rdquo; variant the request scan cannot see.
            </p>
          </div>
          <div className="divide-y divide-rose-500/10">
            {dms.map(f => {
              const skewPct = pct(Math.max(f.toFemale, f.toMale), f.partners)
              const skewWho = f.toFemale >= f.toMale ? 'women' : 'men'
              const quiet = daysAgo(f.lastAt) > 60
              return (
                <div key={f.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                  <Link href={`/admin/users/${f.id}`} className="shrink-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: f.color }}>{getInitials(f.name)}</div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/admin/users/${f.id}`} className="font-semibold text-sm text-white truncate hover:text-amber-400 transition-colors">{f.name}</Link>
                      <CityBadge city={f.city} cities={cities} />
                      <Chip>{skewPct}% to {skewWho}</Chip>
                      {f.reasons.includes('never-replied') && <Chip tone="orange">{f.noReply} never replied</Chip>}
                      {f.suspended && <Chip tone="red">suspended</Chip>}
                      {f.status === 'banned' && <Chip tone="red">banned</Chip>}
                      {f.warningCount > 0 && <Chip tone="orange">⚠ {f.warningCount}</Chip>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {f.partners} people messaged · {f.noReply} never replied · last {day(f.lastAt)}
                      {quiet && <span className="text-zinc-600"> (quiet since)</span>}
                    </div>
                  </div>
                  <Link href={`/admin/users/${f.id}`} className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
                    Review
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
