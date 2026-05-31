'use client'

// /admin/cup — fixture management for the Smileys Cup.
//
// Two things admin does here:
//   1. Fill in knockout slots with real teams once a prior round
//      resolves ("R16-3 home = winner of R32-5").
//   2. Record results — winner + scores — which trigger scoring of
//      every CupPrediction on that fixture, and on QF/Final results
//      every CupBracketPick too.
//
// Group fixtures already have teams baked in (the Dec 5 draw was
// settled at seed time), so the group section here is read-only
// for teams and only takes result entry. Knockouts get team-set
// affordances.

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CUP_TEAMS as TEAMS, teamLabel, ROUND_LABEL } from '@/lib/cup-data'

interface Fixture {
  id:        string
  round:     'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
  group:     string | null
  homeTeam:  string | null
  awayTeam:  string | null
  homeLabel: string | null
  awayLabel: string | null
  kickoffAt: string
  venue:     string | null
  winnerTeam: string | null
  homeScore: number | null
  awayScore: number | null
  points:    number
}

// TEAMS, teamLabel, ROUND_LABEL all imported from @/lib/cup-data
// (single source — server + member page + this admin page all
// read the same constants).

export default function AdminCupPage() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [roundFilter, setRoundFilter] = useState<string>('all')

  function load() {
    fetch('/app/api/cup/fixtures', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.fixtures)) setFixtures(d.fixtures) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Stats — at-a-glance "how much of the tournament has resolved."
  const stats = useMemo(() => {
    if (!fixtures) return null
    const total      = fixtures.length
    const withResult = fixtures.filter(f => f.winnerTeam).length
    const tbd        = fixtures.filter(f => !f.homeTeam || !f.awayTeam).length
    return { total, withResult, tbd }
  }, [fixtures])

  const byRound = useMemo(() => {
    if (!fixtures) return {} as Record<string, Fixture[]>
    return fixtures.reduce((acc: Record<string, Fixture[]>, f) => {
      (acc[f.round] ||= []).push(f)
      return acc
    }, {})
  }, [fixtures])

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">🏆 Cup admin</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Fill in knockout slots as group play resolves · record results · scoring runs in the same transaction
          </p>
        </div>
        <Link href="/cup" className="text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">
          View /cup →
        </Link>
      </div>

      {/* Donations queue — submissions from the public /cup
          "Donate a prize" form. Pending ones surface first so the
          turnaround stays tight (donors expect a reply within a
          day or two). "Approve & publish" creates the sponsor +
          prize rows in one transaction; "Approve only" flips the
          status without conversion (for offers needing follow-up). */}
      <DonationsQueue />

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Total fixtures</div>
            <div className="text-2xl font-extrabold text-white">{stats.total}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">With result</div>
            <div className="text-2xl font-extrabold text-emerald-400">{stats.withResult}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Slots TBD</div>
            <div className="text-2xl font-extrabold text-amber-400">{stats.tbd}</div>
          </div>
        </div>
      )}

      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 border border-zinc-700 w-fit">
        {(['all', 'group', 'r32', 'r16', 'qf', 'sf', 'final'] as const).map(r => (
          <button key={r} onClick={() => setRoundFilter(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roundFilter === r ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
            }`}>
            {r === 'all' ? 'All' : ROUND_LABEL[r]}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-zinc-500 py-12 text-sm">Loading…</div>}

      {!loading && fixtures && (
        <div className="space-y-6">
          {(['group', 'r32', 'r16', 'qf', 'sf', 'final'] as const).map(round => {
            if (roundFilter !== 'all' && roundFilter !== round) return null
            const rows = byRound[round] ?? []
            if (rows.length === 0) return null
            return (
              <section key={round}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="text-sm font-bold text-white">{ROUND_LABEL[round]}</h2>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                    {rows[0].points} pt{rows[0].points === 1 ? '' : 's'} each · {rows.length} match{rows.length === 1 ? '' : 'es'}
                  </span>
                </div>
                <div className="space-y-2">
                  {rows.map(f => <FixtureRow key={f.id} fixture={f} onSaved={load} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FixtureRow({ fixture, onSaved }: { fixture: Fixture; onSaved: () => void }) {
  const [home,       setHome]       = useState(fixture.homeTeam  ?? '')
  const [away,       setAway]       = useState(fixture.awayTeam  ?? '')
  const [winner,     setWinner]     = useState(fixture.winnerTeam ?? '')
  const [homeScore,  setHomeScore]  = useState(fixture.homeScore != null ? String(fixture.homeScore) : '')
  const [awayScore,  setAwayScore]  = useState(fixture.awayScore != null ? String(fixture.awayScore) : '')
  const [saving,     setSaving]     = useState(false)
  const [editing,    setEditing]    = useState(false)

  const isGroup = fixture.round === 'group'
  // Group fixtures came pre-populated with real teams from the
  // draw; knockouts started as TBD labels. We only let admins
  // edit teams on knockouts since editing a group team would
  // contradict the draw itself.
  const teamsEditable = !isGroup
  const hasResult     = !!fixture.winnerTeam

  const kickoff = new Date(fixture.kickoffAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (teamsEditable) {
        if (home !== (fixture.homeTeam ?? '')) body.homeTeam = home || null
        if (away !== (fixture.awayTeam ?? '')) body.awayTeam = away || null
      }
      if (winner !== (fixture.winnerTeam ?? '')) body.winnerTeam = winner || null
      const hs = homeScore === '' ? null : Number(homeScore)
      const as = awayScore === '' ? null : Number(awayScore)
      if (hs !== fixture.homeScore) body.homeScore = hs
      if (as !== fixture.awayScore) body.awayScore = as

      if (Object.keys(body).length === 0) {
        toast('No changes')
        setEditing(false)
        return
      }

      const res = await fetch(`/app/api/admin/cup/fixtures/${fixture.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Save failed'); return }

      const scored = d.predScored ?? 0
      const brackets = d.bracketsRescored ?? 0
      toast.success(
        `Saved${scored ? ` · ${scored} prediction${scored === 1 ? '' : 's'} scored` : ''}${brackets ? ` · ${brackets} bracket${brackets === 1 ? '' : 's'} rescored` : ''}`,
      )
      setEditing(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`bg-zinc-900 border rounded-2xl p-3.5 ${
      hasResult ? 'border-emerald-500/30' : 'border-zinc-800'
    }`}>
      <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-2">
        <span className="font-mono">{fixture.id}{fixture.group ? ` · Group ${fixture.group}` : ''}</span>
        <span>{kickoff}</span>
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {fixture.homeTeam ? teamLabel(fixture.homeTeam) : (fixture.homeLabel ?? '—')}
              <span className="text-zinc-600 mx-1.5">vs</span>
              {fixture.awayTeam ? teamLabel(fixture.awayTeam) : (fixture.awayLabel ?? '—')}
            </div>
            {hasResult && (
              <p className="text-xs text-emerald-400 mt-1 font-semibold">
                {fixture.homeScore}–{fixture.awayScore} · Winner: {teamLabel(fixture.winnerTeam)}
              </p>
            )}
          </div>
          <button onClick={() => setEditing(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">
            {hasResult ? 'Edit' : 'Enter result'}
          </button>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {teamsEditable && (
            <div className="grid grid-cols-2 gap-2">
              <TeamSelect label="Home team" value={home} onChange={setHome} />
              <TeamSelect label="Away team" value={away} onChange={setAway} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Home score</label>
              <input type="number" min={0} value={homeScore} onChange={e => setHomeScore(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Away score</label>
              <input type="number" min={0} value={awayScore} onChange={e => setAwayScore(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>

          {/* Winner restricted to the two teams set on the fixture
              (server validates the same), unless both are still TBD
              in which case we let the admin pick any team — useful
              when filling in a knockout where the prior round
              determines the winner that lands here. */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Winner</label>
            <select value={winner} onChange={e => setWinner(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">— no winner yet —</option>
              {home && <option value={home}>{teamLabel(home)}</option>}
              {away && <option value={away}>{teamLabel(away)}</option>}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => setEditing(false)} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold disabled:opacity-60">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TeamSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
        <option value="">— TBD —</option>
        {TEAMS.map(t => <option key={t.code} value={t.code}>{t.flag} {t.name}</option>)}
      </select>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Donations queue
// Submissions from the public /cup "Donate a prize" form. Pending
// rows first; approved/declined collapsed below. Each pending row
// offers three actions: Decline, Approve & publish (opens inline
// sponsor + prize form, single-transaction publish), Approve only
// (flip status without conversion — for follow-up cases).
// ─────────────────────────────────────────────────────────────────
interface Donation {
  id: string
  donorName: string; donorEmail: string; donorOrganization: string | null; donorPhone: string | null
  prizeTitle: string; prizeDescription: string; estimatedValue: number | null; notes: string | null
  status: 'pending' | 'approved' | 'declined' | string
  reviewedAt: string | null; reviewNote: string | null
  reviewedBy: { id: string; name: string } | null
  linkedSponsorId: string | null; linkedPrizeId: string | null
  createdAt: string
}

function DonationsQueue() {
  const [donations, setDonations] = useState<Donation[] | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  function load() {
    fetch('/app/api/admin/cup/donations', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.donations) setDonations(d.donations) })
  }

  useEffect(() => { load() }, [])

  async function act(id: string, action: 'approve' | 'decline', body?: Record<string, unknown>) {
    const res = await fetch('/app/api/admin/cup/donations', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, ...(body ?? {}) }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Could not update')
      return
    }
    toast.success(action === 'approve' ? (body ? 'Published 🎉' : 'Approved') : 'Declined')
    load()
  }

  if (!donations) return null

  const pending  = donations.filter(d => d.status === 'pending')
  const resolved = donations.filter(d => d.status !== 'pending')

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Prize donations</h2>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {pending.length} pending · {resolved.length} reviewed
          </p>
        </div>
      </div>

      {pending.length === 0 && (
        <p className="px-5 py-4 text-sm text-zinc-500">No pending donations.</p>
      )}

      <div className="divide-y divide-zinc-800">
        {pending.map(d => <DonationRow key={d.id} d={d} onAction={act} />)}
      </div>

      {resolved.length > 0 && (
        <>
          <button onClick={() => setShowResolved(s => !s)}
            className="w-full px-5 py-3 text-left border-t border-zinc-800 text-xs font-semibold text-zinc-500 hover:text-white transition-colors">
            {showResolved ? '↑ Hide' : '↓ Show'} {resolved.length} reviewed
          </button>
          {showResolved && (
            <div className="divide-y divide-zinc-800 border-t border-zinc-800">
              {resolved.map(d => <DonationRow key={d.id} d={d} onAction={act} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DonationRow({ d, onAction }: { d: Donation; onAction: (id: string, action: 'approve' | 'decline', body?: Record<string, unknown>) => void }) {
  const isPending = d.status === 'pending'
  const created = new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  // Inline approve-and-publish form. Pre-filled from the donation
  // so admin can usually hit Save without editing.
  const [showForm, setShowForm] = useState(false)
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  const defaultSponsorName = d.donorOrganization?.trim() || d.donorName
  const [form, setForm] = useState({
    sponsorName:   defaultSponsorName,
    sponsorSlug:   slugify(defaultSponsorName),
    sponsorBlurb:  '',
    sponsorLogoUrl:    '',
    sponsorWebsiteUrl: '',
    prizeTitle:       d.prizeTitle,
    prizeDescription: d.prizeDescription,
    prizeRank:        '' as '' | '1' | '2' | '3',
  })
  const [publishing, setPublishing] = useState(false)

  async function publish() {
    if (!form.prizeTitle.trim()) { toast.error('Prize title required'); return }
    setPublishing(true)
    const body: Record<string, unknown> = {
      prize: {
        title:       form.prizeTitle.trim(),
        description: form.prizeDescription.trim() || null,
        rank:        form.prizeRank ? Number(form.prizeRank) : null,
      },
    }
    if (form.sponsorName.trim()) {
      body.sponsor = {
        name:        form.sponsorName.trim(),
        slug:        form.sponsorSlug.trim() || slugify(form.sponsorName),
        blurb:       form.sponsorBlurb.trim() || null,
        logoUrl:     form.sponsorLogoUrl.trim() || null,
        websiteUrl:  form.sponsorWebsiteUrl.trim() || null,
      }
    }
    await onAction(d.id, 'approve', body)
    setPublishing(false)
    setShowForm(false)
  }

  return (
    <div className={`px-5 py-4 ${isPending ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {!isPending && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              d.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-700 text-zinc-400'
            }`}>{d.status}</span>
          )}
          <p className="text-sm font-bold text-white">{d.prizeTitle}</p>
          {d.estimatedValue !== null && (
            <span className="text-[10px] text-zinc-500">~₺{d.estimatedValue.toLocaleString()}</span>
          )}
        </div>
        <span className="text-[10px] text-zinc-600">{created}</span>
      </div>
      <p className="text-xs text-zinc-300 mb-2 leading-relaxed whitespace-pre-wrap">{d.prizeDescription}</p>
      {d.notes && (
        <p className="text-[10px] text-zinc-500 mb-2 italic">Note: {d.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500 mb-2">
        <span className="font-semibold text-zinc-400">{d.donorName}</span>
        {d.donorOrganization && <span>· {d.donorOrganization}</span>}
        <a href={`mailto:${d.donorEmail}`} className="text-amber-500 hover:underline">{d.donorEmail}</a>
        {d.donorPhone && <a href={`tel:${d.donorPhone}`} className="text-zinc-400 hover:text-amber-500">{d.donorPhone}</a>}
      </div>
      {isPending && !showForm && (
        <div className="flex gap-2 pt-2">
          <button onClick={() => onAction(d.id, 'decline')}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">
            Decline
          </button>
          <button onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 font-semibold">
            Approve &amp; publish →
          </button>
          <button onClick={() => onAction(d.id, 'approve')}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500 font-semibold ml-auto"
            title="Approve without creating the public sponsor/prize entries — for offers that need follow-up first.">
            Approve only
          </button>
        </div>
      )}
      {isPending && showForm && (
        <PublishForm
          form={form} setForm={setForm}
          publishing={publishing}
          onCancel={() => setShowForm(false)}
          onPublish={publish}
        />
      )}
      {!isPending && d.reviewedBy && (
        <p className="text-[10px] text-zinc-500 mt-1">
          {d.status} by {d.reviewedBy.name}
          {d.reviewedAt && ` · ${new Date(d.reviewedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          {d.linkedPrizeId && ' · ✓ published'}
        </p>
      )}
    </div>
  )
}

// Inline publish form — sponsor + prize fields pre-filled from
// the donation. Admin can tweak anything before committing. Saves
// in one transaction via the API's approve-with-conversion path.
function PublishForm({ form, setForm, publishing, onCancel, onPublish }: {
  form: {
    sponsorName: string; sponsorSlug: string; sponsorBlurb: string
    sponsorLogoUrl: string; sponsorWebsiteUrl: string
    prizeTitle: string; prizeDescription: string
    prizeRank: '' | '1' | '2' | '3'
  }
  setForm: (v: typeof form) => void
  publishing: boolean
  onCancel: () => void
  onPublish: () => void
}) {
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm({ ...form, [key]: value })
  }
  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-4">
      <div className="space-y-2">
        <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Sponsor</p>
        <p className="text-[10px] text-zinc-500">Leave blank if you don&apos;t want a public sponsor credit (e.g. internal donation).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <PublishField label="Name">
            <input type="text" value={form.sponsorName}
              onChange={e => { const v = e.target.value; setForm({ ...form, sponsorName: v, sponsorSlug: form.sponsorSlug === slugify(form.sponsorName) ? slugify(v) : form.sponsorSlug }) }}
              className={publishInputCls} />
          </PublishField>
          <PublishField label="Slug">
            <input type="text" value={form.sponsorSlug} onChange={e => set('sponsorSlug', e.target.value)}
              className={publishInputCls} />
          </PublishField>
          <div className="sm:col-span-2">
            <PublishField label="Blurb (1–2 lines)">
              <input type="text" value={form.sponsorBlurb} onChange={e => set('sponsorBlurb', e.target.value)}
                className={publishInputCls} placeholder="A modern restaurant in Beyoğlu." />
            </PublishField>
          </div>
          <PublishField label="Logo URL">
            <input type="text" value={form.sponsorLogoUrl} onChange={e => set('sponsorLogoUrl', e.target.value)}
              className={publishInputCls} placeholder="https://…" />
          </PublishField>
          <PublishField label="Website URL">
            <input type="text" value={form.sponsorWebsiteUrl} onChange={e => set('sponsorWebsiteUrl', e.target.value)}
              className={publishInputCls} placeholder="https://…" />
          </PublishField>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Prize</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <PublishField label="Title">
              <input type="text" value={form.prizeTitle} onChange={e => set('prizeTitle', e.target.value)}
                className={publishInputCls} />
            </PublishField>
          </div>
          <div className="sm:col-span-2">
            <PublishField label="Description">
              <textarea rows={2} value={form.prizeDescription} onChange={e => set('prizeDescription', e.target.value)}
                className={`${publishInputCls} resize-none`} />
            </PublishField>
          </div>
          <PublishField label="Rank">
            <select value={form.prizeRank} onChange={e => set('prizeRank', e.target.value as '' | '1' | '2' | '3')}
              className={publishInputCls}>
              <option value="">Spot prize</option>
              <option value="1">🥇 1st</option>
              <option value="2">🥈 2nd</option>
              <option value="3">🥉 3rd</option>
            </select>
          </PublishField>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} disabled={publishing}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">
          Cancel
        </button>
        <button onClick={onPublish} disabled={publishing}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-60">
          {publishing ? 'Publishing…' : 'Publish prize 🎉'}
        </button>
      </div>
    </div>
  )
}

const publishInputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

function PublishField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}
