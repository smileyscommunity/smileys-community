'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Analytics {
  period: string
  periodLabel: string
  months: string[]
  members:      { total: number; newLast30: number; newPrev30: number; growthRate: number; byMonth: number[] }
  engagement:   { activeMemberCount: number; activeMemberRate: number; dormantCount: number; repeatRsvpRate: number; totalUniqueRsvpers: number; repeatRsvpers: number; dormantMembers: { id: string; name: string; joinedAt: string; interests: string[]; neighborhood: string | null }[] }
  applications: { total: number; approved: number; rejected: number; pending: number; approvalRate: number | null; byMonth: number[]; topInterests: { interest: string; count: number }[] }
  events:       { total: number; published: number; past: number; upcoming: number; avgFillRate: number; totalRsvps: number; byMonth: number[]; rsvpByMonth: number[] }
  revenue:      { collected: number; pending: number; refunded: number; byMonth: number[] }
  reports:      { pending: number; actioned: number; dismissed: number }
  topEvents:    { id: string; title: string; date: string; totalSpots: number; attending: number; fillRate: number }[]
  topClubs:     { id: string; name: string; emoji: string; members: number; events: number }[]
  neighborhoods:    { name: string; members: number; events: number }[]
  revenueByClub:    { id: string; name: string; emoji: string; revenue: number; payments: number }[]
  refundRateByHost: { hostId: string; hostName: string; clubName: string; paid: number; refunded: number; refundedAmount: number; refundRate: number }[]
  interestAlignment: {
    fromApplications:  { interest: string; count: number }[]
    fromAttendedEvents: { interest: string; count: number }[]
  }
}

function StatCard({ label, value, sub, subColor = 'text-zinc-500', href, alert }: {
  label: string; value: string | number; sub?: string; subColor?: string; href?: string; alert?: 'red' | 'amber'
}) {
  const borderClass = alert === 'red' ? 'border-red-500/40' : alert === 'amber' ? 'border-amber-500/30' : 'border-zinc-800'
  const inner = (
    <div className={`bg-zinc-900 rounded-2xl p-5 border ${borderClass} hover:border-zinc-700 transition-colors h-full`}>
      <div className="text-xs text-zinc-500 font-medium mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${alert === 'red' ? 'text-red-400' : alert === 'amber' ? 'text-amber-400' : 'text-white'}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 font-medium ${subColor}`}>{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function MiniBar({ values, months, color = '#f59e0b' }: { values: number[]; months: string[]; color?: string }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1 h-16">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t"
            style={{ height: `${Math.max((v / max) * 48, v > 0 ? 4 : 0)}px`, backgroundColor: color, opacity: i === values.length - 1 ? 1 : 0.5 }}
          />
          <span className="text-[9px] text-zinc-600 leading-none">{months[i]?.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  )
}

function FillBar({ pct, color = '#f59e0b' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
    </div>
  )
}

const PERIODS = [
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '6m',  label: '6 months' },
  { key: '12m', label: '12 months' },
]

export default function AnalyticsPage() {
  const [data,          setData]          = useState<Analytics | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [period,        setPeriod]        = useState('6m')
  const [reengageId,    setReengageId]    = useState<string | null>(null)
  const [reengageMsgs,  setReengageMsgs]  = useState<Record<string, string>>({})
  const [reengageLoad,  setReengageLoad]  = useState<string | null>(null)
  const [showDormant,   setShowDormant]   = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/app/api/admin/analytics?period=${period}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [period])

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-32 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />)}
    </div>
  )

  if (!data) return (
    <div className="p-6 text-zinc-500 text-sm">Failed to load analytics.</div>
  )

  const growthColor = data.members.growthRate >= 0 ? 'text-green-400' : 'text-red-400'
  const growthSign  = data.members.growthRate >= 0 ? '+' : ''

  return (
    <div className="p-4 sm:p-6 space-y-6 text-white">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Analytics</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Platform growth, revenue, and community health</p>
        </div>
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-0.5 shrink-0">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                period === p.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Alerts banner ───────────────────────────────────────────────── */}
      {(() => {
        const alerts: { level: 'red' | 'amber'; msg: string }[] = []
        if (data.events.avgFillRate < 40)           alerts.push({ level: 'red',   msg: `Low avg fill rate (${data.events.avgFillRate}%) — events are not filling up` })
        else if (data.events.avgFillRate < 60)      alerts.push({ level: 'amber', msg: `Avg fill rate is ${data.events.avgFillRate}% — room to improve event promotion` })
        if (data.engagement.activeMemberRate < 20)  alerts.push({ level: 'red',   msg: `Only ${data.engagement.activeMemberRate}% of members active in last 30 days` })
        else if (data.engagement.activeMemberRate < 35) alerts.push({ level: 'amber', msg: `Active member rate is ${data.engagement.activeMemberRate}% — consider re-engagement` })
        if (data.applications.pending >= 10)        alerts.push({ level: 'red',   msg: `${data.applications.pending} applications waiting for review` })
        if (data.reports.pending >= 5)              alerts.push({ level: 'red',   msg: `${data.reports.pending} reports pending action` })
        if (!alerts.length) return null
        const hasRed = alerts.some(a => a.level === 'red')
        return (
          <div className={`rounded-2xl border p-4 space-y-1.5 ${hasRed ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
            <p className={`text-xs font-bold mb-2 ${hasRed ? 'text-red-400' : 'text-amber-400'}`}>Needs attention</p>
            {alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`text-xs font-bold shrink-0 ${a.level === 'red' ? 'text-red-400' : 'text-amber-400'}`}>
                  {a.level === 'red' ? '●' : '○'}
                </span>
                <span className="text-xs text-zinc-300">{a.msg}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── Members ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Members</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatCard label="Total members"    value={data.members.total.toLocaleString()} />
          <StatCard label="New (last 30d)"   value={data.members.newLast30}
            sub={`${growthSign}${data.members.growthRate}% vs prev 30d`} subColor={growthColor} />
          <StatCard label="Approval rate"    value={data.applications.approvalRate != null ? `${data.applications.approvalRate}%` : '—'}
            sub={`${data.applications.approved} approved · ${data.applications.rejected} rejected`} />
          <StatCard label="Pending apps"     value={data.applications.pending}
            href="/admin/applications"
            subColor={data.applications.pending >= 10 ? 'text-red-400' : data.applications.pending > 0 ? 'text-amber-400' : 'text-green-400'}
            alert={data.applications.pending >= 10 ? 'red' : data.applications.pending > 0 ? 'amber' : undefined}
            sub={data.applications.pending >= 10 ? 'Urgent — many pending' : data.applications.pending > 0 ? 'Review now' : 'All clear'} />
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <div className="text-xs font-semibold text-zinc-400 mb-3">Member growth — last 6 months</div>
          <MiniBar values={data.members.byMonth} months={data.months} color="#f59e0b" />
        </div>
      </section>

      {/* ── Engagement ──────────────────────────────────────────────────── */}
      {data.engagement && (
        <section>
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Retention & Engagement</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-xs text-zinc-500 font-medium mb-1">Active member rate</div>
              <div className="text-2xl font-extrabold text-white">{data.engagement.activeMemberRate}%</div>
              <div className="text-xs text-zinc-500 mt-1">
                {data.engagement.activeMemberCount} of {data.members.total} attended an event in last 30 days
              </div>
              <FillBar
                pct={data.engagement.activeMemberRate}
                color={data.engagement.activeMemberRate >= 50 ? '#34d399' : data.engagement.activeMemberRate >= 25 ? '#f59e0b' : '#ef4444'}
              />
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-zinc-500 font-medium mb-1">Dormant members</div>
                  <div className={`text-2xl font-extrabold ${data.engagement.dormantCount > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {data.engagement.dormantCount}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">No attendance in 90+ days</div>
                </div>
                {data.engagement.dormantCount > 0 && (
                  <button onClick={() => setShowDormant(v => !v)}
                    className="text-xs px-2.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 font-semibold transition-colors shrink-0">
                    {showDormant ? 'Hide' : 'Re-engage ↓'}
                  </button>
                )}
              </div>
              {showDormant && data.engagement.dormantMembers.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                  {data.engagement.dormantMembers.map(m => (
                    <div key={m.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-white">{m.name}</span>
                          {m.neighborhood && <span className="text-xs text-zinc-500 ml-1.5">{m.neighborhood}</span>}
                          {m.interests.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {m.interests.slice(0, 3).map(i => (
                                <span key={i} className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded-full capitalize">{i}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={async () => {
                            setReengageLoad(m.id)
                            const res = await fetch('/app/api/admin/users/reengage', {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: m.id }),
                            })
                            if (res.ok) {
                              const { message } = await res.json()
                              setReengageMsgs(prev => ({ ...prev, [m.id]: message }))
                              setReengageId(m.id)
                            }
                            setReengageLoad(null)
                          }}
                          disabled={reengageLoad === m.id}
                          className="text-xs px-2 py-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 font-semibold transition-colors shrink-0 disabled:opacity-50"
                        >
                          {reengageLoad === m.id ? '⏳' : reengageMsgs[m.id] ? '✦ Redraft' : '✦ Draft'}
                        </button>
                      </div>
                      {reengageId === m.id && reengageMsgs[m.id] && (
                        <div className="space-y-1.5">
                          <textarea
                            value={reengageMsgs[m.id]}
                            onChange={e => setReengageMsgs(prev => ({ ...prev, [m.id]: e.target.value }))}
                            rows={3}
                            className="w-full px-2.5 py-2 text-xs bg-zinc-800 border border-violet-500/30 rounded-lg text-white resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                          />
                          <button
                            onClick={async () => {
                              const res = await fetch(`/app/api/admin/users/${m.id}`, {
                                method: 'PATCH', credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ _reengage: reengageMsgs[m.id] }),
                              })
                              if (res.ok) {
                                setReengageMsgs(prev => ({ ...prev, [m.id]: '' }))
                                setReengageId(null)
                              }
                            }}
                            className="w-full py-1.5 text-xs font-semibold bg-violet-500 hover:bg-violet-600 text-white rounded-lg transition-colors"
                          >
                            Send notification
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-xs text-zinc-500 font-medium mb-1">Repeat RSVP rate</div>
              <div className="text-2xl font-extrabold text-white">{data.engagement.repeatRsvpRate}%</div>
              <div className="text-xs text-zinc-500 mt-1">
                {data.engagement.repeatRsvpers} of {data.engagement.totalUniqueRsvpers} attendees have joined 2+ events
              </div>
              <FillBar
                pct={data.engagement.repeatRsvpRate}
                color={data.engagement.repeatRsvpRate >= 60 ? '#34d399' : data.engagement.repeatRsvpRate >= 35 ? '#f59e0b' : '#ef4444'}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Applications ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Applications</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-xs font-semibold text-zinc-400 mb-3">Volume — last 6 months</div>
            <MiniBar values={data.applications.byMonth} months={data.months} color="#a78bfa" />
          </div>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-xs font-semibold text-zinc-400 mb-1">Top interests in applications</div>
            <div className="text-xs text-zinc-600 mb-3">Click to filter applications by interest</div>
            <div className="space-y-2">
              {data.applications.topInterests.slice(0, 5).map(({ interest, count }) => {
                const max = data.applications.topInterests[0]?.count ?? 1
                return (
                  <Link key={interest} href={`/admin/applications?interest=${encodeURIComponent(interest)}`} className="block group">
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-zinc-300 capitalize group-hover:text-violet-400 transition-colors">{interest}</span>
                      <span className="text-zinc-500">{count}</span>
                    </div>
                    <FillBar pct={(count / max) * 100} color="#a78bfa" />
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Neighborhood heatmap ───────────────────────────────────────── */}
      {data.neighborhoods?.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Neighborhood breakdown</h2>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="flex items-center gap-4 mb-4 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Members</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" /> Events</span>
              <span className="ml-auto text-zinc-600">Top {data.neighborhoods.length} neighborhoods</span>
            </div>
            <div className="space-y-3">
              {data.neighborhoods.map(n => {
                const maxMembers = Math.max(...data.neighborhoods.map(x => x.members), 1)
                const maxEvents  = Math.max(...data.neighborhoods.map(x => x.events),  1)
                const underserved = n.members >= 2 && n.events === 0
                return (
                  <div key={n.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-300 font-medium flex items-center gap-1.5">
                        {n.name}
                        {underserved && <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">no events yet</span>}
                      </span>
                      <span className="text-xs text-zinc-600">{n.members}m · {n.events}e</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${(n.members / maxMembers) * 100}%` }} />
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(n.events / maxEvents) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Interest alignment ───────────────────────────────────────────── */}
      {data.interestAlignment && (
        <section>
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Interest alignment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-xs font-semibold text-zinc-400 mb-1">What applicants say they want</div>
              <div className="text-xs text-zinc-600 mb-3">Click to browse applications by interest</div>
              <div className="space-y-2">
                {data.interestAlignment.fromApplications.slice(0, 7).map(({ interest, count }) => {
                  const max = data.interestAlignment.fromApplications[0]?.count ?? 1
                  return (
                    <Link key={interest} href={`/admin/applications?interest=${encodeURIComponent(interest)}`} className="block group">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-zinc-300 capitalize group-hover:text-amber-400 transition-colors">{interest}</span>
                        <span className="text-zinc-500">{count}</span>
                      </div>
                      <FillBar pct={(count / max) * 100} color="#f59e0b" />
                    </Link>
                  )
                })}
                {data.interestAlignment.fromApplications.length === 0 && (
                  <p className="text-xs text-zinc-600">No application interest data yet.</p>
                )}
              </div>
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-xs font-semibold text-zinc-400 mb-1">What members actually attend</div>
              <div className="text-xs text-zinc-600 mb-3">Tags of events with approved RSVPs</div>
              <div className="space-y-2">
                {data.interestAlignment.fromAttendedEvents.slice(0, 7).map(({ interest, count }) => {
                  const max = data.interestAlignment.fromAttendedEvents[0]?.count ?? 1
                  return (
                    <div key={interest}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-zinc-300 capitalize">{interest}</span>
                        <span className="text-zinc-500">{count}</span>
                      </div>
                      <FillBar pct={(count / max) * 100} color="#34d399" />
                    </div>
                  )
                })}
                {data.interestAlignment.fromAttendedEvents.length === 0 && (
                  <p className="text-xs text-zinc-600">No attended event tag data yet.</p>
                )}
              </div>
            </div>
          </div>
          {data.interestAlignment.fromApplications.length > 0 && data.interestAlignment.fromAttendedEvents.length > 0 && (() => {
            const appSet     = new Set(data.interestAlignment.fromApplications.slice(0, 5).map(i => i.interest.toLowerCase()))
            const attendSet  = new Set(data.interestAlignment.fromAttendedEvents.slice(0, 5).map(i => i.interest.toLowerCase()))
            const gaps       = [...appSet].filter(i => !attendSet.has(i))
            if (!gaps.length) return null
            return (
              <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <p className="text-xs font-bold text-amber-400 mb-1">⚡ Potential gap</p>
                <p className="text-xs text-zinc-400">
                  Members apply citing <span className="text-white font-medium">{gaps.join(', ')}</span> as interests, but these don't appear in top attended event tags. Consider programming more events in these areas.
                </p>
              </div>
            )
          })()}
        </section>
      )}

      {/* ── Events ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Events</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatCard label="Total events"   value={data.events.total} />
          <StatCard label="Upcoming"       value={data.events.upcoming} sub="Published" />
          <StatCard label="Total RSVPs"    value={data.events.totalRsvps.toLocaleString()} />
          <StatCard label="Avg fill rate"  value={`${data.events.avgFillRate}%`}
            sub="Across past events"
            subColor={data.events.avgFillRate >= 60 ? 'text-green-400' : data.events.avgFillRate >= 40 ? 'text-amber-400' : 'text-red-400'}
            alert={data.events.avgFillRate < 40 ? 'red' : data.events.avgFillRate < 60 ? 'amber' : undefined} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-xs font-semibold text-zinc-400 mb-3">Events created — last 6 months</div>
            <MiniBar values={data.events.byMonth} months={data.months} color="#34d399" />
          </div>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-xs font-semibold text-zinc-400 mb-3">RSVPs — last 6 months</div>
            <MiniBar values={data.events.rsvpByMonth} months={data.months} color="#60a5fa" />
          </div>
        </div>

        {/* Top events */}
        {data.topEvents.length > 0 && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800">
              <div className="text-sm font-bold text-white">Top events by attendance</div>
              <div className="text-xs text-zinc-500 mt-0.5">Past events sorted by headcount</div>
            </div>
            <div className="divide-y divide-zinc-800">
              {data.topEvents.map(e => (
                <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{e.title}</div>
                    <div className="text-xs text-zinc-500">{new Date(e.date).toLocaleDateString()}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-white">{e.attending}/{e.totalSpots}</div>
                    <div className={`text-xs font-semibold ${e.fillRate >= 80 ? 'text-green-400' : e.fillRate >= 50 ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {e.fillRate}% full
                    </div>
                  </div>
                  <div className="w-16 shrink-0">
                    <FillBar pct={e.fillRate} color={e.fillRate >= 80 ? '#34d399' : e.fillRate >= 50 ? '#f59e0b' : '#71717a'} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Revenue ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Revenue</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <StatCard label="Collected"  value={`₺${data.revenue.collected.toLocaleString()}`} subColor="text-green-400" sub="Paid transactions" />
          <StatCard label="Pending"    value={`₺${data.revenue.pending.toLocaleString()}`}   subColor="text-amber-400" sub="Awaiting payment" href="/admin/payments" />
          <StatCard label="Refunded"   value={`₺${data.revenue.refunded.toLocaleString()}`}  subColor="text-zinc-400"  sub="Total refunded" />
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <div className="text-xs font-semibold text-zinc-400 mb-3">Revenue collected — last 6 months (₺)</div>
          <MiniBar values={data.revenue.byMonth} months={data.months} color="#34d399" />
          {data.revenue.byMonth.every(v => v === 0) && (
            <p className="text-xs text-zinc-600 mt-2">No paid transactions recorded yet.</p>
          )}
        </div>
      </section>

      {/* ── Financial breakdown ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Financial breakdown</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Revenue per club */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-xs font-semibold text-zinc-400 mb-1">Revenue per club</div>
            <div className="text-xs text-zinc-600 mb-4">Ranked by total paid transactions (₺)</div>
            {data.revenueByClub?.length > 0 ? (
              <div className="space-y-3">
                {data.revenueByClub.map((c, i) => {
                  const max = data.revenueByClub[0]?.revenue ?? 1
                  return (
                    <div key={c.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-zinc-300 font-medium flex items-center gap-1.5">
                          <span className="text-zinc-600 text-xs w-3">{i + 1}</span>
                          {c.emoji} {c.name}
                        </span>
                        <span className="text-xs text-amber-400 font-bold">₺{c.revenue.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(c.revenue / max) * 100}%` }} />
                        </div>
                        <span className="text-xs text-zinc-600 shrink-0">{c.payments} txn</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No paid transactions yet.</p>
            )}
          </div>

          {/* Refund rate by host */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-xs font-semibold text-zinc-400 mb-1">Refund rate by host</div>
            <div className="text-xs text-zinc-600 mb-4">Hosts with ≥3 transactions, ranked by refund rate</div>
            {data.refundRateByHost?.length > 0 ? (
              <div className="space-y-3">
                {data.refundRateByHost.map(h => {
                  const color = h.refundRate >= 30 ? '#ef4444' : h.refundRate >= 15 ? '#f59e0b' : '#34d399'
                  return (
                    <div key={h.hostId}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="min-w-0">
                          <span className="text-xs text-zinc-300 font-medium truncate block">{h.hostName}</span>
                          <span className="text-xs text-zinc-600">{h.clubName}</span>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <span className="text-xs font-bold" style={{ color }}>{h.refundRate}%</span>
                          <span className="text-xs text-zinc-600 block">{h.refunded}/{h.paid + h.refunded} refunded</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${h.refundRate}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No refund data yet (requires ≥3 transactions per host).</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Community health ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Community health</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Reports */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <div className="text-sm font-bold text-white mb-3">Reports</div>
            <div className="space-y-2">
              {[
                { label: 'Pending',   count: data.reports.pending,   color: '#ef4444' },
                { label: 'Actioned',  count: data.reports.actioned,  color: '#34d399' },
                { label: 'Dismissed', count: data.reports.dismissed, color: '#71717a' },
              ].map(r => {
                const total = data.reports.pending + data.reports.actioned + data.reports.dismissed || 1
                return (
                  <div key={r.label}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-zinc-400">{r.label}</span>
                      <span className="text-zinc-300 font-semibold">{r.count}</span>
                    </div>
                    <FillBar pct={(r.count / total) * 100} color={r.color} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top clubs */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800">
              <div className="text-sm font-bold text-white">Top clubs by members</div>
            </div>
            <div className="divide-y divide-zinc-800">
              {data.topClubs.map(c => (
                <Link key={c.id} href={`/admin/clubs/${c.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-800/40 transition-colors">
                  <span className="text-lg">{c.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{c.name}</div>
                  </div>
                  <div className="text-right shrink-0 text-xs text-zinc-500">
                    <span className="text-zinc-300 font-semibold">{c.members}</span> members · <span>{c.events}</span> events
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
