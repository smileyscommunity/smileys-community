'use client'

import { toast } from 'sonner'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_CURRENCY, formatMoney, currencySymbol } from '@/lib/data'
import { phonePlaceholder, dialCode } from '@/lib/country'

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
    responseRate:    number | null
    recent: {
      id: string; title: string; emoji: string; date: string
      wouldReturnRate: number | null; responses: number; anomalyCount: number; responseRate: number | null
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

const INDUSTRIES = [
  'Tech', 'Finance', 'Real Estate', 'Creative & Design', 'Marketing',
  'Hospitality', 'Education', 'Health & Wellness', 'Legal', 'Consulting',
  'Retail', 'Manufacturing', 'Non-profit', 'Other',
]

const PROFESSIONAL_STATUS_OPTIONS = [
  { id: 'open_to_networking', label: '🤝 Open to networking' },
  { id: 'hiring',             label: '🚀 Hiring / Recruiting' },
  { id: 'seeking_advice',     label: '💡 Seeking advice'     },
  { id: 'social_only',        label: '🥨 Social only'        },
]

export default function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const cur = useCurrentCity()?.currency ?? DEFAULT_CURRENCY
  const country = useCurrentCity()?.country
  const { id } = use(params)
  const router  = useRouter()
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'

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

  useEffect(() => {
    setLoading(true)
    fetch(`/app/api/admin/users/${id}`)
      .then(r => r.json())
      .then(d => {
        setUser(d)
        setProfileForm({
          email: d.email || '',
          phone: d.phone || '',
          nationality: d.nationality || '',
          neighborhood: d.neighborhood || '',
          instagram: d.instagram || '',
          languages: d.languages.join(', '),
          interests: d.interests.join(', '),
          bio: d.bio || '',
          partnerId: d.partnerId || '',
          industry: d.industry || '',
          professionalRole: d.professionalRole || '',
          professionalStatus: d.professionalStatus || '',
        })
      })
      .finally(() => setLoading(false))
  }, [id])

  const addNote = async () => {
    if (!note.trim()) return
    const res = await fetch(`/app/api/admin/users/${id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: note }),
    })
    if (res.ok) {
      const newNote = await res.json()
      setUser(u => u ? { ...u, adminNotes: [newNote, ...u.adminNotes] } : null)
      setNote('')
      toast.success('Note added')
    }
  }

  const handleBan = async () => {
    if (!banReason.trim()) return toast.error('Please provide a reason')
    setBanning(true)
    const res = await fetch(`/app/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'banned', banReason }),
    })
    if (res.ok) {
      setUser(u => u ? { ...u, status: 'banned' } : null)
      setBanConfirm(false)
      toast.success('User banned')
    }
    setBanning(false)
  }

  const handleWarn = async () => {
    if (!warnReason.trim()) return toast.error('Please provide a reason')
    setWarning(true)
    const res = await fetch(`/app/api/admin/users/${id}/warn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: warnReason }),
    })
    if (res.ok) {
      setUser(u => u ? { ...u, warningCount: u.warningCount + 1 } : null)
      setWarnConfirm(false)
      toast.success('Warning sent')
    }
    setWarning(false)
  }

  const handleRemove = async () => {
    setRemoving(true)
    const res = await fetch(`/app/api/admin/users/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('User removed')
      router.push('/admin/users')
    } else {
      toast.error('Failed to remove')
      setRemoving(false)
    }
  }

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

  const changeRole = async (role: string) => {
    const res = await fetch(`/app/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      setUser(u => u ? { ...u, role } : null)
      toast.success(`Role updated to ${role}`)
    }
  }

  const changeStatus = async (status: string) => {
    const res = await fetch(`/app/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setUser(u => u ? { ...u, status } : null)
      toast.success(`Status updated to ${status}`)
    }
  }

  const changeMembership = async (membershipType: string) => {
    const res = await fetch(`/app/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipType }),
    })
    if (res.ok) {
      setUser(u => u ? { ...u, membershipType } : null)
      toast.success(`Membership set to ${membershipType}`)
    } else {
      toast.error('Could not update membership')
    }
  }

  const [profileForm,   setProfileForm]   = useState({
    email: '', phone: '', nationality: '', neighborhood: '', instagram: '',
    languages: '', interests: '', bio: '', partnerId: '',
    industry: '', professionalRole: '', professionalStatus: '',
  })
  const [partners,      setPartners]      = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/app/api/partners').then(r => r.json()).then(d => setPartners(Array.isArray(d) ? d : []))
  }, [])

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const res = await fetch(`/app/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profileForm,
          languages: profileForm.languages.split(',').map((s: string) => s.trim()).filter(Boolean),
          interests: profileForm.interests.split(',').map((s: string) => s.trim()).filter(Boolean),
          partnerId: profileForm.partnerId || null,
        }),
      })
      if (res.ok) {
        toast.success('Profile updated')
        const updated = await res.json()
        setUser(updated)
      } else {
        const d = await res.json()
        toast.error(d.error || 'Failed to update')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSavingProfile(false)
    }
  }

  if (loading) return <div className="p-8 text-zinc-500">Loading user...</div>
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
          {isAdmin && user.status !== 'banned' && user.role !== 'admin' && (
            <button onClick={() => setSuspendConfirm(true)} className="text-xs px-3 py-1.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 font-semibold transition-colors">
              Suspend
            </button>
          )}
          {user.status !== 'banned' && user.role !== 'admin' && (
            <button onClick={() => setBanConfirm(true)} className="text-xs px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-semibold transition-colors">
              Ban
            </button>
          )}

          <Link
            href={`/admin/applications?tab=approved&search=${encodeURIComponent(user.email)}`}
            className="text-xs px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-semibold transition-colors text-center"
          >
            View application
          </Link>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-3 lg:gap-6 space-y-6 lg:space-y-0">

        {/* ── LEFT: Stats & Details ── */}
        <div className="lg:col-span-1 space-y-6">

          {/* Stats overview */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Activity</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-800/50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Going</p>
                <p className="text-xl font-black text-white">{attendedEvents.length}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Checked in</p>
                <p className="text-xl font-black text-white">{checkedInCount}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">No shows</p>
                <p className="text-xl font-black text-white">{noShowCount}</p>
                {noShowRate > 0 && <p className={`text-[10px] font-bold mt-0.5 ${noShowRate > 30 ? 'text-red-500' : 'text-zinc-500'}`}>{noShowRate}% rate</p>}
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Total spent</p>
                <p className="text-xl font-black text-white">{formatMoney(totalSpent, cur)}</p>
              </div>
            </div>

            {user.status === 'banned' && (
              <button onClick={() => changeStatus('approved')} className="w-full py-2.5 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 font-bold text-xs transition-colors mt-2">
                Unban user
              </button>
            )}

            {user.role === 'member' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button onClick={() => changeRole('moderator')} className="py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 font-bold text-xs transition-colors">
                  → Moderator
                </button>
                <button onClick={() => changeRole('partner')} className="py-2.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 font-bold text-xs transition-colors">
                  → Partner
                </button>
              </div>
            )}
            {user.role !== 'member' && user.role !== 'admin' && (
              <button onClick={() => changeRole('member')} className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 font-bold text-xs transition-colors mt-2">
                Revoke privileges
              </button>
            )}

            {/* Membership tier — admin-granted (no self-serve payment yet) */}
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Membership</p>
              <div className="grid grid-cols-3 gap-2">
                {(['free', 'premium', 'vip'] as const).map(t => (
                  <button key={t} onClick={() => changeMembership(t)} disabled={user.membershipType === t}
                    className={`py-2 rounded-xl border font-bold text-xs capitalize transition-colors ${
                      user.membershipType === t
                        ? 'bg-amber-500 text-white border-amber-500 cursor-default'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Direct WhatsApp Message — Quick template */}
          {user.phone && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                WhatsApp Message
              </h3>
              <p className="text-[10px] text-zinc-500 mb-3 leading-tight">Send a quick WhatsApp message to this member using one of these templates.</p>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    const text = encodeURIComponent(`Hi ${user.name.split(' ')[0]}, this is Smileys Community. We're reaching out regarding your membership.`)
                    window.open(`https://wa.me/${user.phone!.replace(/\D/g, '')}?text=${text}`, '_blank')
                  }}
                  className="w-full text-left p-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 transition-colors text-xs text-zinc-300"
                >
                  <span className="font-bold block text-zinc-500 mb-0.5 uppercase text-[9px]">General inquiry</span>
                  "Hi ${user.name.split(' ')[0]}, this is Smileys..."
                </button>
                <button
                  onClick={() => {
                    const text = encodeURIComponent(`Hi ${user.name.split(' ')[0]}, we noticed you missed the event today. Is everything okay? We hope to see you next time!`)
                    window.open(`https://wa.me/${user.phone!.replace(/\D/g, '')}?text=${text}`, '_blank')
                  }}
                  className="w-full text-left p-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 transition-colors text-xs text-zinc-300"
                >
                  <span className="font-bold block text-zinc-500 mb-0.5 uppercase text-[9px]">No-show follow up</span>
                  "Hi ${user.name.split(' ')[0]}, we noticed you missed..."
                </button>
              </div>
            </div>
          )}

          {/* Quick Edit */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Quick Edit</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Email</label>
                <input type="email" value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
                <p className="text-[10px] text-zinc-600 mt-1">Login identifier — after a change they sign in with the new address.</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Phone</label>
                <input type="text" value={profileForm.phone} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })}
                  placeholder={phonePlaceholder(country)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
                <p className="text-[10px] text-zinc-600 mt-1">Include the country code — members often type only the local number, which breaks the WhatsApp link above.</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Nationality</label>
                <input type="text" value={profileForm.nationality} onChange={e => setProfileForm({ ...profileForm, nationality: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Neighborhood</label>
                <input type="text" value={profileForm.neighborhood} onChange={e => setProfileForm({ ...profileForm, neighborhood: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Instagram</label>
                <input type="text" value={profileForm.instagram} onChange={e => setProfileForm({ ...profileForm, instagram: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Partner association</label>
                <select value={profileForm.partnerId} onChange={e => setProfileForm({ ...profileForm, partnerId: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none">
                  <option value="">None</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="pt-2 border-t border-zinc-800/50">
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-3">Professional background</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Industry</label>
                    <select value={profileForm.industry} onChange={e => setProfileForm({ ...profileForm, industry: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none">
                      <option value="">Select industry…</option>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Role / Job Title</label>
                    <input type="text" value={profileForm.professionalRole} onChange={e => setProfileForm({ ...profileForm, professionalRole: e.target.value })}
                      placeholder="e.g. Founder" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Networking Goal</label>
                  <select value={profileForm.professionalStatus} onChange={e => setProfileForm({ ...profileForm, professionalStatus: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none">
                    <option value="">Select goal…</option>
                    {PROFESSIONAL_STATUS_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Bio</label>
                <textarea value={profileForm.bio} onChange={e => setProfileForm({ ...profileForm, bio: e.target.value })} rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" />
              </div>
              <button onClick={handleSaveProfile} disabled={savingProfile}
                className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-bold text-xs rounded-xl transition-colors">
                {savingProfile ? 'Saving...' : 'Save basic info'}
              </button>
            </div>
          </div>

          {/* Dangerous Zone */}
          {isAdmin && user.role !== 'admin' && (
            <div className="bg-red-500/5 rounded-2xl border border-red-500/20 p-5">
              <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-3">Dangerous Area</h3>
              <button onClick={() => setRemoveConfirm(true)} className="w-full py-2.5 rounded-xl border border-red-500/20 hover:bg-red-500/10 text-red-500 font-bold text-xs transition-colors">
                Delete account completely
              </button>
              <p className="text-[9px] text-red-500/50 mt-2 text-center uppercase font-bold tracking-tight">Irreversible action</p>
            </div>
          )}

        </div>

        {/* ── RIGHT: Timeline & Notes ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Host Quality — surfaces only for hosts */}
          {user.hostQuality && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Host Quality</h3>
                <div className="flex gap-4">
                  <div className="text-center">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase leading-none mb-1">Return rate</p>
                    <p className={`text-lg font-black leading-none ${user.hostQuality.wouldReturnRate != null ? (user.hostQuality.wouldReturnRate >= 90 ? 'text-green-400' : 'text-amber-400') : 'text-zinc-600'}`}>
                      {user.hostQuality.wouldReturnRate != null ? `${user.hostQuality.wouldReturnRate}%` : '—'}
                    </p>
                  </div>
                  <div className="text-center border-l border-zinc-800 pl-4">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase leading-none mb-1">Anomalies</p>
                    <p className={`text-lg font-black leading-none ${user.hostQuality.anomalyCount > 0 ? 'text-red-500' : 'text-zinc-600'}`}>
                      {user.hostQuality.anomalyCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Host Recent Events Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                {user.hostQuality.recent.map(ev => (
                  <Link key={ev.id} href={`/admin/events/${ev.id}/edit`} className="bg-zinc-800/40 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-base shrink-0">{ev.emoji}</span>
                        <p className="text-xs font-bold text-white truncate">{ev.title}</p>
                      </div>
                      <span className="text-[9px] font-bold text-zinc-600 uppercase shrink-0">{new Date(ev.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500">Return:</span>
                        <span className={`text-[10px] font-bold ${ev.wouldReturnRate != null ? (ev.wouldReturnRate >= 80 ? 'text-green-500' : 'text-amber-500') : 'text-zinc-600'}`}>
                          {ev.wouldReturnRate != null ? `${ev.wouldReturnRate}%` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500">Responses:</span>
                        <span className="text-[10px] font-bold text-zinc-300">{ev.responses}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Admin notes */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden flex flex-col h-[400px]">
            <div className="p-4 border-b border-zinc-800 shrink-0">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Internal Admin Notes</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
              {user.adminNotes.length === 0 ? (
                <p className="text-xs text-zinc-600 italic text-center py-10">No notes yet.</p>
              ) : (
                user.adminNotes.map(n => (
                  <div key={n.id} className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-800">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-amber-500 uppercase">{n.adminName}</span>
                      <span className="text-[9px] text-zinc-600 uppercase font-bold">{new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    </div>
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{n.text}</p>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 bg-zinc-950/50 border-t border-zinc-800 shrink-0">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNote()}
                  placeholder="Add a private note..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600"
                />
                <button
                  onClick={addNote}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm rounded-xl transition-colors border border-zinc-700"
                >
                  Post
                </button>
              </div>
            </div>
          </div>

          {/* Event history */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden flex flex-col h-[500px]">
            <div className="p-4 border-b border-zinc-800 shrink-0 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Attendance History</h3>
              <span className="text-xs font-bold text-zinc-500 uppercase">{attendedEvents.length} events</span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800 scrollbar-hide">
              {attendedEvents.length === 0 ? (
                <p className="text-xs text-zinc-600 italic text-center py-20">No event activity yet.</p>
              ) : (
                attendedEvents.map(je => (
                  <Link key={je.event.id} href={`/admin/events/${je.event.id}/participants`} className="flex items-center gap-3 p-4 hover:bg-zinc-800/40 transition-colors group">
                    <span className="text-2xl shrink-0 select-none grayscale group-hover:grayscale-0 transition-all">{je.event.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-bold text-white truncate">{je.event.title}</p>
                        {je.status !== 'approved' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 uppercase">{je.status}</span>}
                      </div>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{new Date(je.event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {je.event.neighborhood}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {je.checkedIn ? (
                        <span className="text-[10px] font-black text-green-500 uppercase tracking-tight">Checked In ✓</span>
                      ) : (
                        <span className={`text-[10px] font-black uppercase tracking-tight ${new Date(je.event.date) < new Date() ? 'text-red-500' : 'text-zinc-600'}`}>
                          {new Date(je.event.date) < new Date() ? 'No Show' : 'Upcoming'}
                        </span>
                      )}
                      <p className="text-[10px] font-bold text-zinc-600 uppercase mt-0.5">{formatMoney(je.event.price ?? 0, cur)}</p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Modals */}
      {banConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setBanConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-white mb-2">Ban {user.name}?</h2>
            <p className="text-sm text-zinc-500 mb-4">This will permanently prevent the user from logging in or attending events. This action is recorded in the audit log.</p>
            <textarea
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              placeholder="Reason for banning..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500 mb-4 h-24 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setBanConfirm(false)} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors">Cancel</button>
              <button onClick={handleBan} disabled={banning} className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50">
                {banning ? 'Banning...' : 'Confirm Ban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {warnConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setWarnConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-white mb-2">Warn {user.name}?</h2>
            <p className="text-sm text-zinc-500 mb-4">The user will receive an email and a push notification with your warning reason. Their warning count will increase by 1.</p>
            <textarea
              value={warnReason}
              onChange={e => setWarnReason(e.target.value)}
              placeholder="Reason for warning..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500 mb-4 h-24 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setWarnConfirm(false)} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors">Cancel</button>
              <button onClick={handleWarn} disabled={warning} className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm transition-colors disabled:opacity-50">
                {warning ? 'Sending...' : 'Send Warning'}
              </button>
            </div>
          </div>
        </div>
      )}

      {suspendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSuspendConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-white mb-2">Suspend {user.name}</h2>
            <p className="text-sm text-zinc-500 mb-4">Temporarily block access for a set duration. Recorded in audit log.</p>
            <div className="flex gap-2 mb-4">
              {['24', '48', '72', '168'].map(h => (
                <button key={h} onClick={() => setSuspendHours(h)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${suspendHours === h ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{h}h</button>
              ))}
            </div>
            <textarea
              value={suspendReason}
              onChange={e => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 mb-4 h-24 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setSuspendConfirm(false)} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors">Cancel</button>
              <button onClick={handleSuspend} disabled={suspending} className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm transition-colors disabled:opacity-50">
                {suspending ? 'Suspending...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={() => setRemoveConfirm(false)}>
          <div className="bg-zinc-950 border border-red-500/20 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-red-500 mb-2">Irreversible: Delete {user.name}?</h2>
            <p className="text-sm text-zinc-500 mb-6">This will purge the user and all their non-financial data from the platform. Are you absolutely sure?</p>
            <div className="flex gap-2">
              <button onClick={() => setRemoveConfirm(false)} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors">Abort</button>
              <button onClick={handleRemove} disabled={removing} className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50">
                {removing ? 'Deleting...' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {waModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setWaModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-white mb-2">WhatsApp: {user.name}</h2>
            <p className="text-xs text-zinc-500 mb-4 italic leading-tight">Send a custom WhatsApp message or use one of the templates on the profile sidebar.</p>
            <textarea
              value={waMessage}
              onChange={e => setWaMessage(e.target.value)}
              placeholder="Type your message here..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500 mb-4 h-32 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setWaModal(false)} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors">Cancel</button>
              <button
                onClick={() => {
                  const text = encodeURIComponent(waMessage)
                  window.open(`https://wa.me/${user.phone!.replace(/\D/g, '')}?text=${text}`, '_blank')
                  setWaModal(false)
                }}
                disabled={!waMessage.trim()}
                className="flex-1 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                Open WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
