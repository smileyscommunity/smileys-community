'use client'

import { toast } from 'sonner'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface AttendedEvent {
  id: string
  title: string
  date: string
  neighborhood: string
  price: number
  emoji: string
}

interface AdminNote {
  id:        string
  adminName: string
  text:      string
  createdAt: string
}

interface UserDetail {
  id: string
  name: string
  email: string
  role: string
  color: string
  emailVerified: boolean
  joinedAt: string | null
  lastActive: string | null
  bio: string | null
  neighborhood: string | null
  instagram: string | null
  phone: string | null
  profilePhoto: string | null
  nationality: string | null
  languages: string[]
  interests: string[]
  status: string
  membershipType: string
  warningCount: number
  adminNotes: AdminNote[]
  joinedEvents: { event: AttendedEvent; joinedAt: string; checkedIn: boolean; status: string }[]
  // Aggregate host quality — surfaces only when the user has hosted
  // at least one event. wouldReturnRate stays null when the events
  // exist but no surveys have responded yet.
  hostQuality: {
    eventsHosted:    number
    surveyResponses: number
    wouldReturnRate: number | null
    anomalyCount:    number
    recent: {
      id: string; title: string; emoji: string; date: string
      wouldReturnRate: number | null; responses: number; anomalyCount: number
    }[]
  } | null
}

const roleBadge: Record<string, string> = {
  admin:     'bg-amber-500/10 text-amber-400',
  moderator: 'bg-purple-500/10 text-purple-400',
  partner:   'bg-blue-500/10 text-blue-400',
  member:    'bg-zinc-700 text-zinc-400',
}

const statusBadge: Record<string, string> = {
  approved: 'bg-green-500/10 text-green-400',
  pending:  'bg-yellow-500/10 text-yellow-400',
  banned:   'bg-red-500/10 text-red-400',
}

const membershipBadge: Record<string, string> = {
  free:    'bg-zinc-700 text-zinc-400',
  premium: 'bg-amber-500/10 text-amber-400',
  vip:     'bg-violet-500/10 text-violet-400',
}

export default function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [user,       setUser]       = useState<UserDetail | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [note,       setNote]       = useState('')
  const [banConfirm,    setBanConfirm]    = useState(false)
  const [banReason,     setBanReason]     = useState('')
  const [banning,       setBanning]       = useState(false)
  const [warnConfirm,   setWarnConfirm]   = useState(false)
  const [warnReason,    setWarnReason]    = useState('')
  const [warning,       setWarning]       = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState(false)
  const [removing,      setRemoving]      = useState(false)
  const [suspendConfirm, setSuspendConfirm] = useState(false)
  const [suspendReason,  setSuspendReason]  = useState('')
  const [suspendHours,   setSuspendHours]   = useState('24')
  const [suspending,     setSuspending]     = useState(false)
  const [savingProfile,    setSavingProfile]    = useState(false)
  const [waModal,          setWaModal]          = useState(false)
  const [waMessage,        setWaMessage]        = useState('')

  const handleSuspend = async () => {
    if (!suspendReason.trim()) return toast.error('Please provide a reason')
    setSuspending(true)
    try {
      const hours = parseInt(suspendHours)
      const until = new Date()
      until.setHours(until.getHours() + hours)

      const res = await fetch(`/app/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suspendedUntil: until.toISOString(),
          suspensionNote: suspendReason
        }),
      })
      if (res.ok) {
        toast.success(`User suspended for ${hours} hours`)
        setSuspendConfirm(false)
        setSuspendReason('')
        // Reload user to show updated status if UI supports it
        window.location.reload()
      } else {
        const d = await res.json()
        toast.error(d.error || 'Failed to suspend')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSuspending(false)
    }
  }
  const [clubAssignments,  setClubAssignments]  = useState<{ clubId: string; clubName: string; emoji: string }[]>([])
  const [profileForm,   setProfileForm]   = useState({
    nationality: '', neighborhood: '', instagram: '',
    languages: '', interests: '', bio: '', partnerId: '',
  })
  const [partners,      setPartners]      = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/app/api/partners').then(r => r.json()).then(d => setPartners(Array.isArray(d) ? d : []))
  }, [])

  useEffect(() => {
    // Club assignments are included in the user detail API response — no separate fetch needed

    fetch(`/app/api/admin/users/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data.error) {
          setUser(data)
          if (Array.isArray(data.clubMemberships)) {
            setClubAssignments(data.clubMemberships.map((m: any) => ({
              clubId: m.club.id, clubName: m.club.name, emoji: m.club.emoji,
            })))
          }
          setProfileForm({
            nationality:  data.nationality  ?? '',
            neighborhood: data.neighborhood ?? '',
            instagram:    data.instagram    ?? '',
            languages:    Array.isArray(data.languages) ? data.languages.join(', ') : '',
            interests:    Array.isArray(data.interests)  ? data.interests.join(', ')  : '',
            bio:          data.bio          ?? '',
            partnerId:    data.partnerId    ?? '',
            })
            }        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])


  async function saveProfile() {
    setSavingProfile(true)
    const data = {
      ...profileForm,
      languages: profileForm.languages.split(',').map((s: string) => s.trim()).filter(Boolean),
      interests: profileForm.interests.split(',').map((s: string) => s.trim()).filter(Boolean),
    }
    const ok = await patch(data)
    setSavingProfile(false)
    if (ok) toast.success('Profile updated ✓')
  }

  async function patch(data: Record<string, unknown>) {
    const res = await fetch(`/app/api/admin/users/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const updated = await res.json()
      setUser(prev => prev ? { ...prev, ...updated } : prev)
      return true
    }
    return false
  }

  async function changeRole(role: string) {
    if (await patch({ role })) toast.success(`Role changed to ${role} ✓`)
  }

  async function changeStatus(status: string) {
    if (await patch({ status })) toast.success(`Status set to ${status} ✓`)
  }

  async function banUser() {
    setBanning(true)
    const ok = await patch({ status: 'banned', banReason: banReason.trim() || null })
    setBanning(false)
    if (ok) {
      setBanConfirm(false)
      setBanReason('')
      toast.success('User banned ✓')
    }
  }

  async function changeMembership(membershipType: string) {
    if (await patch({ membershipType })) toast.success(`Membership set to ${membershipType} ✓`)
  }

  async function removeUser() {
    setRemoving(true)
    const res = await fetch(`/app/api/admin/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    setRemoving(false)
    if (res.ok) {
      setRemoveConfirm(false)
      toast('User removed')
      setTimeout(() => router.push('/admin/users'), 1500)
    }
  }

  async function addNote() {
    if (!note.trim()) return
    const res = await fetch(`/app/api/admin/users/${id}/notes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: note.trim() }),
    })
    if (res.ok) {
      const newNote = await res.json()
      setUser(prev => prev ? { ...prev, adminNotes: [newNote, ...prev.adminNotes] } : null)
      setNote('')
      toast.success('Note saved ✓')
    }
  }

  async function issueWarning() {
    if (!warnReason.trim()) return
    setWarning(true)
    const res = await fetch(`/app/api/admin/users/${id}/warn`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: warnReason.trim() }),
    })
    setWarning(false)
    if (res.ok) {
      const { warningCount } = await res.json()
      // Refresh user data to show new note and count
      setUser(prev => prev ? { 
        ...prev, 
        warningCount,
        adminNotes: [{
          id: Math.random().toString(),
          adminName: 'System',
          text: `⚠️ Formal Warning #${warningCount}: ${warnReason.trim()}`,
          createdAt: new Date().toISOString()
        }, ...prev.adminNotes]
      } : null)
      setWarnConfirm(false)
      setWarnReason('')
      toast.success('Warning issued ✓')
    }
  }

  function openWhatsApp() {
    if (!user?.phone) return
    const digits = user.phone.replace(/\D/g, '').replace(/^0/, '90')
    const url = `https://wa.me/${digits}${waMessage.trim() ? `?text=${encodeURIComponent(waMessage.trim())}` : ''}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setWaModal(false)
    setWaMessage('')
  }

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-zinc-500">User not found.</p>
        <Link href="/admin/users" className="text-amber-500 text-sm mt-2 inline-block">← Back to users</Link>
      </div>
    )
  }

  const attendedEvents = user.joinedEvents
  const totalSpent     = attendedEvents.reduce((sum, je) => sum + (je.event.price ?? 0), 0)
  const pastJoined     = attendedEvents.filter(je => je.event.date < new Date().toISOString().split('T')[0])
  const checkedInCount = pastJoined.filter(je => je.checkedIn).length
  const noShowCount    = pastJoined.filter(je => !je.checkedIn).length
  const noShowRate     = pastJoined.length > 0 ? Math.round((noShowCount / pastJoined.length) * 100) : 0
  const daysSinceJoin  = user.joinedAt
    ? Math.floor((Date.now() - new Date(user.joinedAt).getTime()) / 86400000)
    : null
  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="p-6 max-w-4xl space-y-6">

      {/* Back */}
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm text-zinc-500">Users</span>
      </div>

      {/* Profile header */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 sm:p-6 flex flex-col sm:flex-row gap-5">
        {/* Avatar + info */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
            style={{ backgroundColor: user.color || '#6b7280' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-white text-xl sm:text-2xl font-extrabold">{user.name}</h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${roleBadge[user.role] ?? roleBadge.member}`}>{user.role}</span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${statusBadge[user.status] ?? statusBadge.approved}`}>{user.status}</span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${membershipBadge[user.membershipType] ?? membershipBadge.free}`}>{user.membershipType}</span>
              {!user.emailVerified && (
                <>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Unverified</span>
                  <button
                    onClick={async () => {
                      const res = await fetch('/app/api/auth/resend-verification', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: user.email }),
                      })
                      if (res.ok) toast.success('Verification email sent ✓')
                      else toast.error('Failed to send')
                    }}
                    className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors border border-amber-500/20"
                  >
                    Resend verification
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {user.phone && (
                <button onClick={() => setWaModal(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 transition-colors">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 flex-wrap">
              {user.joinedAt && <span>Joined {new Date(user.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
              {daysSinceJoin !== null && <span>· {daysSinceJoin}d</span>}
              {user.lastActive && <span>· Active {new Date(user.lastActive).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
            </div>
            {user.bio && <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed line-clamp-2">{user.bio}</p>}
          </div>
        </div>

        {/* Action buttons — wraps below on mobile, column on desktop */}
        <div className="flex flex-row flex-wrap sm:flex-col gap-2 sm:shrink-0">
          {user.role !== 'admin' && (
            <button onClick={() => setWarnConfirm(true)} className="text-xs px-3 py-1.5 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 font-semibold transition-colors">
              Warn
            </button>
          )}
          {user.status !== 'banned' && user.role !== 'admin' && (
            <button onClick={() => setSuspendConfirm(true)} className="text-xs px-3 py-1.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 font-semibold transition-colors">
              Suspend
            </button>
          )}
          {user.status !== 'banned' && user.role !== 'admin' && (
            <button onClick={() => setBanConfirm(true)} className="text-xs px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-semibold transition-colors">
              Ban
            </button>
          )}
          {user.status === 'banned' && (
            <button onClick={() => changeStatus('approved')} className="text-xs px-3 py-1.5 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 font-semibold transition-colors">
              Unban
            </button>
          )}
          {user.role === 'member' && (
            <button onClick={() => changeRole('moderator')} className="text-xs px-3 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 font-semibold transition-colors">
              → Mod
            </button>
          )}
          {user.role === 'member' && (
            <button onClick={() => changeRole('partner')} className="text-xs px-3 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 font-semibold transition-colors">
              → Partner
            </button>
          )}
          {(user.role === 'moderator' || user.role === 'partner') && (
            <button onClick={() => changeRole('member')} className="text-xs px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-semibold transition-colors">
              → Member
            </button>
          )}
          {user.role !== 'admin' && (
            <button onClick={() => setRemoveConfirm(true)} className="text-xs px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-semibold transition-colors">
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Stats — four cards. grid-cols-3 left a single orphan card on
          row 2 at every viewport because the data is 4-wide. Now 2 per
          row on mobile (where text-3xl + p-5 in a 120px column was
          cramped) and 4 per row from sm+ where there's screen space.
          Padding scales with the column width. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Events attended', value: attendedEvents.length,  color: 'text-white' },
          { label: 'No-show rate',   value: pastJoined.length > 0 ? `${noShowRate}%` : '—', color: noShowRate >= 50 ? 'text-red-400' : noShowRate >= 25 ? 'text-amber-400' : 'text-green-400' },
          { label: 'Total spent',     value: `₺${totalSpent}`,       color: 'text-green-400' },
          { label: 'Days as member',  value: daysSinceJoin ?? '—',   color: 'text-white' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
            <div className={`text-2xl sm:text-3xl font-extrabold ${s.color}`}>{s.value}</div>
            <div className="text-xs sm:text-sm text-zinc-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Host quality card — surfaces only when the user has hosted
          at least one event. The wouldReturn rate is the single most
          powerful host-quality signal on the platform: an objective
          "would the room come back?" number, aggregated across every
          event they've run, hard to game. Recent-6 row lets admins
          spot a trend (improving / declining / consistent) before
          taking action. */}
      {user.hostQuality && user.hostQuality.eventsHosted > 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div>
              <h3 className="text-sm font-bold text-white">Host quality</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {user.hostQuality.surveyResponses > 0
                  ? `${user.hostQuality.surveyResponses} post-event survey response${user.hostQuality.surveyResponses === 1 ? '' : 's'} across ${user.hostQuality.eventsHosted} hosted event${user.hostQuality.eventsHosted === 1 ? '' : 's'}`
                  : `${user.hostQuality.eventsHosted} hosted event${user.hostQuality.eventsHosted === 1 ? '' : 's'} — no survey responses yet`}
              </p>
            </div>
            {user.hostQuality.anomalyCount > 0 && (
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">
                ⚠ {user.hostQuality.anomalyCount} anomal{user.hostQuality.anomalyCount === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="bg-zinc-950/40 rounded-xl p-3">
              <div className={`text-2xl sm:text-3xl font-extrabold ${
                user.hostQuality.wouldReturnRate === null  ? 'text-zinc-600'
                  : user.hostQuality.wouldReturnRate >= 80 ? 'text-green-400'
                  : user.hostQuality.wouldReturnRate >= 60 ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {user.hostQuality.wouldReturnRate === null ? '—' : `${user.hostQuality.wouldReturnRate}%`}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Would attend again</div>
            </div>
            <div className="bg-zinc-950/40 rounded-xl p-3">
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{user.hostQuality.eventsHosted}</div>
              <div className="text-xs text-zinc-500 mt-1">Events hosted</div>
            </div>
            <div className="bg-zinc-950/40 rounded-xl p-3 col-span-2 sm:col-span-1">
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{user.hostQuality.surveyResponses}</div>
              <div className="text-xs text-zinc-500 mt-1">Responses collected</div>
            </div>
          </div>

          {user.hostQuality.recent.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-2">Recent — last {user.hostQuality.recent.length}</p>
              <div className="space-y-1.5">
                {user.hostQuality.recent.map(e => (
                  <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-950/40 hover:bg-zinc-800 transition-colors">
                    <span className="text-base shrink-0">{e.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{e.title}</p>
                      <p className="text-[10px] text-zinc-600">{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                    </div>
                    <div className="text-right shrink-0 text-xs">
                      {e.wouldReturnRate !== null ? (
                        <span className={`font-bold ${
                          e.wouldReturnRate >= 80 ? 'text-green-400'
                            : e.wouldReturnRate >= 60 ? 'text-amber-400'
                            : 'text-red-400'
                        }`}>{e.wouldReturnRate}%</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                      <span className="text-zinc-600 ml-1">{e.responses > 0 ? `(${e.responses})` : ''}</span>
                      {e.anomalyCount > 0 && (
                        <span className="ml-1.5 px-1 rounded bg-red-500/20 text-red-400 font-bold">⚠{e.anomalyCount}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profile details + Membership */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="text-white font-bold">Profile</h2>
          </div>
          <div className="p-5 space-y-3">
            {user.phone && (
              <div>
                <label className="block text-zinc-400 text-xs font-semibold mb-1">Phone</label>
                <div className="w-full px-3 py-2 text-sm bg-zinc-800/50 border border-zinc-700/50 text-zinc-500 rounded-xl">
                  ••• (on file)
                </div>
              </div>
            )}
            {[
              { key: 'nationality',  label: 'Nationality',  type: 'text', placeholder: 'e.g. Turkish' },
              { key: 'neighborhood', label: 'Neighborhood', type: 'text', placeholder: 'e.g. Karaköy' },
              { key: 'instagram',    label: 'Instagram',    type: 'text', placeholder: '@username' },
              { key: 'languages',    label: 'Languages',    type: 'text', placeholder: 'English, Turkish' },
              { key: 'interests',    label: 'Interests',    type: 'text', placeholder: 'Sailing, Photography' },
              { key: 'bio',          label: 'Bio',          type: 'text', placeholder: 'Short bio…' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className="block text-zinc-400 text-xs font-semibold mb-1">{label}</label>
                <input
                  type={type}
                  value={profileForm[key as keyof typeof profileForm]}
                  onChange={e => setProfileForm(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>
            ))}
            
            <div>
              <label className="block text-zinc-400 text-xs font-semibold mb-1">Partner Association</label>
              <select
                value={profileForm.partnerId}
                onChange={e => setProfileForm(p => ({ ...p, partnerId: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 text-white rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none appearance-none"
              >
                <option value="">None</option>
                {partners.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-zinc-500">Verified: {user.emailVerified ? '✓ Yes' : '— No'}</span>
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50 transition-colors"
              >
                {savingProfile ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Membership */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <h2 className="text-white font-bold mb-3">Membership</h2>
            <div className="flex gap-2">
              {(['free', 'premium', 'vip'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => changeMembership(type)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold capitalize transition-colors ${
                    user.membershipType === type
                      ? membershipBadge[type]
                      : 'bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            <h2 className="text-white font-bold mb-3">Status</h2>
            <div className="flex gap-2">
              {(['pending', 'approved', 'banned'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold capitalize transition-colors ${
                    user.status === s
                      ? statusBadge[s]
                      : 'bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Events attended */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-white font-bold">Events attended</h2>
              {pastJoined.length > 0 && noShowRate >= 25 && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${noShowRate >= 50 ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  ⚠️ {noShowRate}% no-show
                </span>
              )}
            </div>
            {attendedEvents.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">No events yet.</p>
            ) : (
              <div className="divide-y divide-zinc-800 max-h-64 overflow-y-auto">
                {attendedEvents.map(je => {
                  const isPastEvent = je.event.date < new Date().toISOString().split('T')[0]
                  return (
                    <Link key={je.event.id} href={`/admin/events/${je.event.id}/edit`} className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors group">
                      <span className="text-lg">{je.event.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-zinc-200 group-hover:text-amber-400 transition-colors truncate">{je.event.title}</div>
                        <div className="text-xs text-zinc-500">{je.event.date}</div>
                      </div>
                      {isPastEvent && (
                        <span className={`text-xs font-semibold shrink-0 ${je.checkedIn ? 'text-green-400' : 'text-red-400'}`}>
                          {je.checkedIn ? '✓ Attended' : '✗ No-show'}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-zinc-500 shrink-0">₺{je.event.price}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Club host assignments */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-white font-bold">Club host assignments</h2>
          <Link href="/admin/clubs" className="text-xs text-amber-500 hover:underline font-medium">Manage in Clubs →</Link>
        </div>
        {clubAssignments.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500">Not assigned as host in any club. Go to a club's members panel to assign.</p>
        ) : (
          <div className="divide-y divide-zinc-800">
            {clubAssignments.map(c => (
              <div key={c.clubId} className="px-5 py-3 flex items-center gap-3">
                <span className="text-xl">{c.emoji}</span>
                <span className="text-sm font-semibold text-zinc-200">{c.clubName}</span>
                <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">Host</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-white font-bold">Admin notes</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder="Add a note…"
              className="flex-1 text-sm px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              onClick={addNote}
              disabled={!note.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors"
            >
              Add
            </button>
          </div>
          {user.adminNotes.length === 0 && <p className="text-xs text-zinc-500">No notes yet.</p>}
          <div className="space-y-3">
            {user.adminNotes.map((n) => (
              <div key={n.id} className="flex flex-col gap-0.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">{n.adminName}</span>
                  <span className="text-zinc-600 text-xs">· {new Date(n.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <span className={`text-zinc-200 ${n.text.startsWith('⚠️') ? 'text-amber-400 font-medium' : ''}`}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Remove confirmation modal ── */}
      {removeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setRemoveConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-white">Remove {user?.name}?</h3>
                <p className="text-xs text-zinc-400">This permanently deletes their account and all data. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRemoveConfirm(false)} className="flex-1 py-2.5 text-sm font-medium border border-zinc-700 rounded-xl text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={removeUser} disabled={removing} className="flex-1 py-2.5 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors disabled:opacity-50">
                {removing ? 'Removing…' : 'Permanently remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ban confirmation modal ── */}
      {banConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setBanConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-white">Ban {user?.name}?</h3>
                <p className="text-xs text-zinc-400">They will be immediately blocked from logging in.</p>
              </div>
            </div>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Reason <span className="font-normal text-zinc-500">(optional)</span></label>
              <input
                type="text"
                value={banReason}
                onChange={e => setBanReason(e.target.value)}
                placeholder="e.g. Harassment at event on May 3"
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBanConfirm(false)} className="flex-1 py-2.5 text-sm font-medium border border-zinc-700 rounded-xl text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={banUser} disabled={banning} className="flex-1 py-2.5 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors disabled:opacity-50">
                {banning ? 'Banning…' : 'Confirm ban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Warning confirmation modal ── */}
      {warnConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setWarnConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-white">Warn {user?.name}?</h3>
                <p className="text-xs text-zinc-400">This will increment their warning count and send them a formal notification.</p>
              </div>
            </div>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Reason for warning</label>
              <textarea
                value={warnReason}
                onChange={e => setWarnReason(e.target.value)}
                rows={3}
                placeholder="e.g. Unprofessional behavior in event chat"
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setWarnConfirm(false)} className="flex-1 py-2.5 text-sm font-medium border border-zinc-700 rounded-xl text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={issueWarning} disabled={warning || !warnReason.trim()} className="flex-1 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors disabled:opacity-50">
                {warning ? 'Processing…' : 'Issue warning'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── WhatsApp message modal ── */}
      {waModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setWaModal(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-white">Message {user?.name}</h3>
                <p className="text-xs text-zinc-400">via WhatsApp</p>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Message <span className="font-normal text-zinc-500">(optional — pre-fills WhatsApp)</span></label>
              <textarea
                value={waMessage}
                onChange={e => setWaMessage(e.target.value)}
                rows={4}
                placeholder="Hi! This is Smileys Community…"
                autoFocus
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setWaModal(false)} className="flex-1 py-2.5 text-sm font-medium border border-zinc-700 rounded-xl text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={openWhatsApp} className="flex-1 py-2.5 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-xl transition-colors flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Open WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Suspend confirmation modal ── */}
      {suspendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setSuspendConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-white">Suspend {user?.name}?</h3>
                <p className="text-xs text-zinc-400">They will be unable to log in for the specified duration.</p>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Duration</label>
              <select 
                value={suspendHours}
                onChange={e => setSuspendHours(e.target.value)}
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50 appearance-none"
              >
                <option value="24">24 Hours</option>
                <option value="48">48 Hours</option>
                <option value="72">72 Hours</option>
                <option value="168">1 Week</option>
              </select>
            </div>

            <div className="mb-5">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Reason for suspension</label>
              <textarea
                value={suspendReason}
                onChange={e => setSuspendReason(e.target.value)}
                rows={3}
                placeholder="e.g. Temporary block for investigation..."
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
              />
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setSuspendConfirm(false)} className="flex-1 py-2.5 text-sm font-medium border border-zinc-700 rounded-xl text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleSuspend} disabled={suspending || !suspendReason.trim()} className="flex-1 py-2.5 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition-colors disabled:opacity-50">
                {suspending ? 'Suspending…' : 'Suspend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
