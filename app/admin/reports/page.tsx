'use client'

import { useState, useEffect } from 'react'

interface MonthPoint { label: string; count?: number; amount?: number }
interface RankedEvent {
  id: string; title: string; emoji: string; date: string
  totalSpots: number; attended: number; fillPct: number; revenue: number
}
interface ClubStat {
  id: string; name: string; emoji: string; bgColor: string
  members: number; pastEvents: number; avgFill: number; revenue: number
}
interface ReportData {
  summary: { totalMembers: number; totalPastEvents: number; avgFillRate: number; totalRevenue: number }
  membersByMonth: MonthPoint[]
  revenueByMonth: MonthPoint[]
  rankedEvents: RankedEvent[]
  clubStats: ClubStat[]
}

function BarChart({ points, valueKey, color, prefix = '', suffix = '' }: {
  points: MonthPoint[]
  valueKey: 'count' | 'amount'
  color: string
  prefix?: string
  suffix?: string
}) {
  const values = points.map(p => p[valueKey] ?? 0)
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1.5 h-24">
      {points.map((p, i) => {
        const val = p[valueKey] ?? 0
        const pct = (val / max) * 100
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block text-xs text-white bg-zinc-700 px-1.5 py-0.5 rounded whitespace-nowrap z-10">
              {prefix}{valueKey === 'amount' ? val.toLocaleString() : val}{suffix}
            </div>
            <div className="w-full rounded-t" style={{ height: `${Math.max(pct, 2)}%`, backgroundColor: color, opacity: val === 0 ? 0.2 : 1 }} />
            <span className="text-[9px] text-zinc-600">{p.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function AdminReportsPage() {
  const [data,    setData]    = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/admin/reports', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-zinc-400 text-sm">Loading…</div>
  if (!data)   return <div className="p-8 text-zinc-400 text-sm">Failed to load.</div>

  const { summary, membersByMonth, revenueByMonth, rankedEvents, clubStats } = data
  const maxClubRevenue = Math.max(...clubStats.map(c => c.revenue), 1)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Analytics</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Historical performance — all time</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Members',    value: summary.totalMembers,                          color: 'text-blue-400'   },
          { label: 'Events Run',       value: summary.totalPastEvents,                       color: 'text-amber-400'  },
          { label: 'Avg Fill Rate',    value: `${summary.avgFillRate}%`,                     color: summary.avgFillRate >= 70 ? 'text-green-400' : 'text-amber-400' },
          { label: 'Revenue Earned',   value: `₺${summary.totalRevenue.toLocaleString()}`,   color: 'text-violet-400' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <h2 className="text-sm font-bold text-white mb-5">New Members — last 6 months</h2>
          <BarChart points={membersByMonth} valueKey="count" color="#60a5fa" suffix=" members" />
          <div className="flex justify-between mt-3 text-xs text-zinc-600">
            <span>Total: {membersByMonth.reduce((s, m) => s + (m.count ?? 0), 0)} new members</span>
            <span>Peak: {Math.max(...membersByMonth.map(m => m.count ?? 0))}/mo</span>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <h2 className="text-sm font-bold text-white mb-5">Revenue — last 6 months</h2>
          <BarChart points={revenueByMonth} valueKey="amount" color="#a78bfa" prefix="₺" />
          <div className="flex justify-between mt-3 text-xs text-zinc-600">
            <span>Total: ₺{revenueByMonth.reduce((s, m) => s + (m.amount ?? 0), 0).toLocaleString()}</span>
            <span>Peak: ₺{Math.max(...revenueByMonth.map(m => m.amount ?? 0)).toLocaleString()}/mo</span>
          </div>
        </div>
      </div>

      {/* Top events */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
        <h2 className="text-sm font-bold text-white mb-5">Top Past Events by Fill Rate</h2>
        {rankedEvents.length === 0 ? (
          <p className="text-zinc-500 text-sm">No past events yet.</p>
        ) : (
          <div className="space-y-3">
            {rankedEvents.map((e, i) => (
              <div key={e.id} className="flex items-center gap-4">
                <span className="text-xs font-bold text-zinc-600 w-5 text-right shrink-0">#{i + 1}</span>
                <span className="text-base shrink-0">{e.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-200 truncate">{e.title}</span>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      {e.revenue > 0 && <span className="text-xs text-violet-400 font-semibold">₺{e.revenue.toLocaleString()}</span>}
                      <span className="text-xs text-zinc-400">{e.attended}/{e.totalSpots}</span>
                      <span className={`text-xs font-bold w-9 text-right ${e.fillPct >= 90 ? 'text-green-400' : e.fillPct >= 60 ? 'text-amber-400' : 'text-zinc-500'}`}>{e.fillPct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${e.fillPct >= 90 ? 'bg-green-500' : e.fillPct >= 60 ? 'bg-amber-500' : 'bg-zinc-600'}`}
                      style={{ width: `${e.fillPct}%` }} />
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {new Date(e.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Club leaderboard */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
        <h2 className="text-sm font-bold text-white mb-5">Club Performance</h2>
        {clubStats.length === 0 ? (
          <p className="text-zinc-500 text-sm">No clubs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                  <th className="text-left pb-3 pr-4">Club</th>
                  <th className="text-center pb-3 px-3 hidden sm:table-cell">Members</th>
                  <th className="text-center pb-3 px-3 hidden sm:table-cell">Events run</th>
                  <th className="text-center pb-3 px-3">Avg fill</th>
                  <th className="text-right pb-3 pl-3">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {clubStats.map(c => (
                  <tr key={c.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg ${c.bgColor ?? 'bg-zinc-800'} flex items-center justify-center text-base shrink-0`}>{c.emoji}</div>
                        <div>
                          <div className="font-medium text-zinc-200">{c.name}</div>
                          <div className="h-1 w-20 bg-zinc-800 rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(c.revenue / maxClubRevenue) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-center text-zinc-400 hidden sm:table-cell">{c.members}</td>
                    <td className="py-3 text-center text-zinc-400 hidden sm:table-cell">{c.pastEvents}</td>
                    <td className="py-3 text-center">
                      <span className={`font-semibold ${c.avgFill >= 70 ? 'text-green-400' : c.avgFill >= 40 ? 'text-amber-400' : 'text-zinc-500'}`}>
                        {c.pastEvents > 0 ? `${c.avgFill}%` : '—'}
                      </span>
                    </td>
                    <td className="py-3 text-right font-semibold text-zinc-200">
                      {c.revenue > 0 ? `₺${c.revenue.toLocaleString()}` : <span className="text-zinc-600 font-normal">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
