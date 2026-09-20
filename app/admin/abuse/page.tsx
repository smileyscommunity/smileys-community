'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { getInitials } from '@/lib/data'
import { CityBadge, useAdminCities } from '@/components/admin/CitySelect'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { useAuth } from '@/contexts/AuthContext'
import { memberHref } from '@/lib/adminNav'

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

// The measures the detector actually uses, so a comparison compares evidence
// rather than an invented severity score. Higher is worse on every one, which
// is what makes "worse on N of M" mean anything.
const requestMeasures = (f: RequestFlag) => ({
  'requests sent': f.sent,
  'gender skew':   pct(Math.max(f.toFemale, f.toMale), f.toFemale + f.toMale || 1),
  'not accepted':  100 - pct(f.accepted, f.sent),
  'left ignored':  pct(f.pending, f.sent),
})
const dmMeasures = (f: DmFlag) => ({
  'people messaged': f.partners,
  'gender skew':     pct(Math.max(f.toFemale, f.toMale), f.partners),
  'never replied':   f.noReply,
})

function worseThan<T extends Record<string, number>>(mine: T, base: T | null): string[] | null {
  if (!base) return null
  return (Object.keys(mine) as (keyof T)[]).filter(k => mine[k] > base[k]) as string[]
}

function Chip({ tone = 'rose', children }: { tone?: 'rose' | 'orange' | 'zinc' | 'red' | 'amber'; children: React.ReactNode }) {
  const tones = {
    rose:   'bg-rose-500/10 text-rose-400 border-rose-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    zinc:   'bg-zinc-800 text-zinc-400 border-zinc-700',
    red:    'bg-red-500/10 text-red-400 border-red-500/20',
    amber:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  }
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>
}

function Comparison({ worse, total, baseName }: { worse: string[] | null; total: number; baseName: string }) {
  if (!worse) return null
  return (
    <div className="text-[11px] mt-0.5">
      {worse.length === 0
        ? <span className="text-zinc-600">Not worse than {baseName} on any measure</span>
        : <span className="text-rose-400">Worse than {baseName} on {worse.length} of {total}: {worse.join(', ')}</span>}
    </div>
  )
}

export default function AdminAbusePage() {
  const [requests, setRequests] = useState<RequestFlag[]>([])
  const [dms,      setDms]      = useState<DmFlag[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)
  // Whose record everyone else is read against. One baseline across both
  // lists, because the people worth comparing against are on both.
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const cities = useAdminCities()
  const { user: me } = useAuth()
  const viewerRole = me?.role
  // Moderators only ever see their own city (the API scopes them), so an
  // empty page means "none here", not "none anywhere".
  const scoped = viewerRole === 'moderator'

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

  // Flagged on BOTH signals: fanning out AND working the inbox once accepted.
  // Materially stronger than either alone, and before this it could only be
  // spotted by reading one list against the other.
  const bothIds = useMemo(() => {
    const dmIds = new Set(dms.map(d => d.id))
    return new Set(requests.filter(r => dmIds.has(r.id)).map(r => r.id))
  }, [requests, dms])

  // Everyone flagged, for the picker — someone may be on the DM list only.
  const everyone = useMemo(() => {
    const seen = new Map<string, string>()
    for (const f of [...requests, ...dms]) if (!seen.has(f.id)) seen.set(f.id, f.name)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [requests, dms])

  const baseline    = useMemo(() => everyone.find(e => e.id === baselineId) ?? everyone[0] ?? null, [everyone, baselineId])
  const baseRequest = useMemo(() => requests.find(r => r.id === baseline?.id) ?? null, [requests, baseline])
  const baseDm      = useMemo(() => dms.find(d => d.id === baseline?.id) ?? null, [dms, baseline])
  const baseReqM    = baseRequest ? requestMeasures(baseRequest) : null
  const baseDmM     = baseDm ? dmMeasures(baseDm) : null

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>

  const nothing = requests.length === 0 && dms.length === 0

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Abuse signals</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Members whose outbound requests or messages look like directory-trawling rather than networking.
          Counted over their whole time here, so a case stays on the record after it stops.
          {scoped && ' Scoped to your city.'}
        </p>
      </div>

      {error && <LoadErrorBanner message={error} onRetry={() => { setLoading(true); setTick(t => t + 1) }} title="Couldn't load abuse signals" />}

      {!error && nothing && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center">
          <p className="text-sm text-zinc-400 font-semibold">Nothing flagged{scoped ? ' in your city' : ''}.</p>
          <p className="text-xs text-zinc-600 mt-1">
            {scoped
              ? 'No member in your city crosses the thresholds. Members in other cities are not counted here.'
              : 'No member crosses the thresholds on requests or messages.'}
          </p>
        </div>
      )}

      {/* How to read it. Every caveat here changes what a flag means, so they
          sit above the lists rather than in a tooltip nobody opens. */}
      {!nothing && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-xs text-zinc-500 space-y-1.5">
          <p><span className="text-zinc-300 font-semibold">These counts understate.</span> Declined and withdrawn requests are deleted, so &ldquo;10 sent&rdquo; means at least 10.</p>
          <p><span className="text-zinc-300 font-semibold">Gender is from the application</span>, not the editable profile — otherwise anyone flagged could edit their way out. A misclick on /apply persists, so open the profile before acting.</p>
          <p><span className="text-zinc-300 font-semibold">A flag is a reason to look</span>, never a reason to act. Nothing here happens automatically.</p>
        </div>
      )}

      {/* Both signals at once — the strongest reading in the data, and the one
          that took cross-referencing two lists to see. */}
      {bothIds.size > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/25 rounded-2xl p-4">
          <h2 className="text-sm font-bold text-amber-300">
            On both signals <Chip tone="amber">{bothIds.size}</Chip>
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 mb-2.5">
            Fanning out on requests <em>and</em> working the inbox once accepted. Both lists below mark these.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {requests.filter(r => bothIds.has(r.id)).map(r => {
              const d = dms.find(x => x.id === r.id)!
              return (
                <Link key={r.id} href={memberHref(r.id, viewerRole)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-amber-500/20 text-zinc-300 hover:border-amber-500/50 transition-colors">
                  <span className="font-semibold text-white">{r.name}</span>
                  <span className="text-zinc-500"> · {r.sent} req · {d.partners} DMs</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Compare-to picker. "Worse on N of M" is only honest if the measures
          are the detector's own, so that is exactly what it counts. */}
      {everyone.length > 1 && baseline && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 flex flex-wrap items-center gap-2">
          <label htmlFor="baseline" className="text-xs text-zinc-400 font-semibold">Compare everyone against</label>
          <select
            id="baseline"
            value={baseline.id}
            onChange={e => setBaselineId(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            {everyone.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <span className="text-xs text-zinc-600">
            {baseRequest ? `${baseRequest.sent} requests` : 'not on the requests list'}
            {' · '}
            {baseDm ? `${baseDm.partners} people messaged` : 'not on the messages list'}
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
              const m = requestMeasures(f)
              const skewWho = f.toFemale >= f.toMale ? 'women' : 'men'
              const quiet = daysAgo(f.lastAt) > 60
              return (
                <div key={f.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                  <Link href={memberHref(f.id, viewerRole)} className="shrink-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: f.color }}>{getInitials(f.name)}</div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={memberHref(f.id, viewerRole)} className="font-semibold text-sm text-white truncate hover:text-amber-400 transition-colors">{f.name}</Link>
                      <CityBadge city={f.city} cities={cities} />
                      {bothIds.has(f.id) && <Chip tone="amber">both signals</Chip>}
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
                    {f.id !== baseline?.id && baseReqM && (
                      <Comparison worse={worseThan(m, baseReqM)} total={4} baseName={baseline!.name} />
                    )}
                  </div>
                  <Link href={memberHref(f.id, viewerRole)} className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
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
              const m = dmMeasures(f)
              const skewWho = f.toFemale >= f.toMale ? 'women' : 'men'
              const quiet = daysAgo(f.lastAt) > 60
              return (
                <div key={f.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                  <Link href={memberHref(f.id, viewerRole)} className="shrink-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: f.color }}>{getInitials(f.name)}</div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={memberHref(f.id, viewerRole)} className="font-semibold text-sm text-white truncate hover:text-amber-400 transition-colors">{f.name}</Link>
                      <CityBadge city={f.city} cities={cities} />
                      {bothIds.has(f.id) && <Chip tone="amber">both signals</Chip>}
                      {baseline?.id === f.id && <Chip tone="zinc">baseline</Chip>}
                      <Chip>{m['gender skew']}% to {skewWho}</Chip>
                      {f.reasons.includes('never-replied') && <Chip tone="orange">{f.noReply} never replied</Chip>}
                      {f.suspended && <Chip tone="red">suspended</Chip>}
                      {f.status === 'banned' && <Chip tone="red">banned</Chip>}
                      {f.warningCount > 0 && <Chip tone="orange">⚠ {f.warningCount}</Chip>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {f.partners} people messaged · {f.noReply} never replied · last {day(f.lastAt)}
                      {quiet && <span className="text-zinc-600"> (quiet since)</span>}
                    </div>
                    {f.id !== baseline?.id && baseDmM && (
                      <Comparison worse={worseThan(m, baseDmM)} total={3} baseName={baseline!.name} />
                    )}
                  </div>
                  <Link href={memberHref(f.id, viewerRole)} className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
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
