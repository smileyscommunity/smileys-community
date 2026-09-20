'use client'

import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { pushOptedOut, setPushOptedOut, rememberPushSynced, forgetPushSync } from '@/lib/pushDevice'
import ActiveDevicesSection from '@/components/settings/ActiveDevicesSection'
import HomeCitySection from '@/components/settings/HomeCitySection'
import TwoFactorSection from '@/components/settings/TwoFactorSection'
import DeleteAccountSection from '@/components/settings/DeleteAccountSection'
import PasswordToggle from '@/components/PasswordToggle'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// iOS only delivers web push to a home-screen install, and Safari-in-the-tab
// exposes no PushManager at all — so "not supported" is the wrong thing to
// say there. It's "not yet": there is something the member can do about it.
function isIosBrowserNotInstalled(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)  // iPadOS reports as a Mac
  if (!ios) return false
  const installed = window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return !installed
}

// navigator.serviceWorker.ready NEVER settles when no worker was registered,
// so awaiting it left this section stuck on 'loading' — which rendered
// nothing at all, on every browser without a worker. getRegistration settles,
// and the timeout covers the browsers where even that hangs behind a
// still-installing worker.
async function registrationOrNull(ms = 4000): Promise<ServiceWorkerRegistration | null> {
  try {
    return await Promise.race([
      navigator.serviceWorker.getRegistration().then(r => r ?? null),
      new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
    ])
  } catch { return null }
}

function PushNotificationsSection({ userId }: { userId: string }) {
  const [state, setState] = useState<'loading' | 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'>('loading')
  const [busy,  setBusy]  = useState(false)

  const check = useCallback(async () => {
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
      setState(isIosBrowserNotInstalled() ? 'needs-install' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') { setState('denied'); return }
    const reg = await registrationOrNull()
    if (!reg) {
      setState(isIosBrowserNotInstalled() ? 'needs-install' : 'unsupported')
      return
    }
    const sub = await reg.pushManager.getSubscription().catch(() => null)
    setState(sub && !pushOptedOut() ? 'on' : 'off')
  }, [])

  useEffect(() => { check() }, [check])

  async function enable() {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'denied') { setState('denied'); return }
      if (permission !== 'granted') {
        // 'default' means the member closed the browser's prompt without
        // answering. That isn't a refusal, and showing them the "unblock this
        // site in your browser settings" dead end for it was wrong — the
        // toggle stays, and one more tap re-opens the prompt.
        setState('off')
        toast("Notifications weren't enabled — tap again if you want them.")
        return
      }
      const reg = await registrationOrNull()
      if (!reg) throw new Error('no service worker')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
      const res = await fetch('/app/api/push/subscribe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('subscribe failed')
      // Clear the device's refusal and stamp the sync the prompt reads, so
      // turning it on here doesn't leave PushPermission thinking this browser
      // is overdue for one.
      setPushOptedOut(false)
      rememberPushSynced(userId)
      setState('on')
    } catch {
      toast.error('Could not turn on push notifications — try again')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const reg = await registrationOrNull()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/app/api/push/subscribe', {
          method: 'DELETE', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      // Remembered per device: the browser permission stays granted, so
      // without this the prompt's re-sync subscribes this device again on the
      // next page load and the toggle flips itself back on.
      setPushOptedOut(true)
      setState('off')
    } catch {
      toast.error('Could not turn off push notifications — try again')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return null

  return (
    <Section title="Push Notifications" description="Get notified on this device even when the app is closed">
      {state === 'unsupported' ? (
        <p className="text-xs text-gray-600">
          Push isn&apos;t available in this browser. You&apos;ll still get emails and the in-app bell.
        </p>
      ) : state === 'needs-install' ? (
        <p className="text-xs text-gray-600">
          Add Smileys to your Home Screen to get notifications — on iPhone and iPad,
          Safari only delivers them to the installed app. Tap Share, then &ldquo;Add to Home Screen&rdquo;.
        </p>
      ) : state === 'denied' ? (
        <p className="text-xs text-gray-600">
          Notifications are blocked in your browser. To enable, open your browser settings and allow notifications for this site.
        </p>
      ) : (
        <Toggle
          label="Push notifications"
          description="Events, RSVPs, and club activity on this device"
          checked={state === 'on'}
          disabled={busy}
          onChange={() => (state === 'on' ? disable() : enable())}
        />
      )}
    </Section>
  )
}

// `id` gives a section a link of its own: /settings#notifications is where the
// bell's gear now lands, and without the scroll margin the sticky header sits
// on top of the heading it just jumped to.
function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <div id={id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden${id ? ' scroll-mt-24' : ''}`}>
      <div className="px-5 py-4 border-b border-gray-50">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

// A bare <button> with a coloured pill inside announces itself as an unnamed
// button in a screen reader — nothing about it says "switch", and nothing
// says whether it's on. role/aria-checked plus the visible label as its
// accessible name is the whole fix.
function Toggle({ label, description, checked, onChange, disabled }: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const labelId = useId()
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${checked ? 'bg-amber-500' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

// Everything the preferences API accepts, and the shape the page keeps. The
// defaults match the route's own defaults — but they are only ever SHOWN
// after a successful load, never saved on behalf of a member whose real
// settings we failed to read.
interface Prefs {
  newEvents:    boolean
  reminders:    boolean
  eventUpdates: boolean
  joinedEvents: boolean
  wallPosts:    boolean
  wallReplies:  boolean
  quietHours:   boolean
  quietFrom:    number
  quietTo:      number
}

const DEFAULT_PREFS: Prefs = {
  newEvents: true, reminders: true, eventUpdates: true,
  joinedEvents: true, wallPosts: true, wallReplies: true,
  quietHours: false, quietFrom: 23, quietTo: 9,
}

// The API answers with the whole Prisma row (id, userId, timestamps). Only
// the nine fields above belong in state.
function pickPrefs(raw: unknown): Partial<Prefs> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<Prefs> = {}
  for (const k of ['newEvents', 'reminders', 'eventUpdates', 'joinedEvents', 'wallPosts', 'wallReplies', 'quietHours'] as const) {
    if (typeof r[k] === 'boolean') out[k] = r[k] as boolean
  }
  for (const k of ['quietFrom', 'quietTo'] as const) {
    if (typeof r[k] === 'number') out[k] = r[k] as number
  }
  return out
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// When a pending email-change link dies, on the clock of the city the member
// is looking at. hourCycle 'h23' rather than hour12:false — the latter
// renders midnight as 24:05 on server ICU builds.
function formatExpiry(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'soon'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
    }).format(d)
  } catch { return 'soon' }
}

export default function SettingsPage() {
  const { user } = useAuth()
  // Quiet hours run on the member's HOME city clock (lib/notify), which is
  // the city being viewed only when they haven't browsed off it — homeName
  // is filled in exactly when they have.
  const city = useCurrentCity()
  const homeCityName = city ? (city.viewing ? city.homeName : city.name) : null

  // Password
  const [current,   setCurrent]   = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [pwStatus,  setPwStatus]  = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [pwError,   setPwError]   = useState('')
  const [pwTotp,      setPwTotp]      = useState('')
  const [pwNeedsTotp, setPwNeedsTotp] = useState(false)

  // Notification prefs. `prefsState` is the whole point: a failed load used
  // to leave the all-true defaults on screen, and the next toggle PUT them
  // back over whatever the member had actually chosen.
  const [prefs,      setPrefs]      = useState<Prefs>(DEFAULT_PREFS)
  const [prefsState, setPrefsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [savingPref, setSavingPref] = useState<keyof Prefs | null>(null)
  const [prefsOk,    setPrefsOk]    = useState(false)
  // What the server last told us — the only safe thing to roll a failed save
  // back to. Rolling back to the state captured before the flip re-applied
  // whatever a previous in-flight save had already changed.
  const serverPrefs = useRef<Prefs>(DEFAULT_PREFS)

  // Email address change (moved here from /profile so account security
  // lives in one place)
  const [newEmail,       setNewEmail]       = useState('')
  const [emailTotp,      setEmailTotp]      = useState('')
  const [emailNeedsTotp, setEmailNeedsTotp] = useState(false)
  const [emailPassword,  setEmailPassword]  = useState('')
  const [showEmailPw,    setShowEmailPw]    = useState(false)
  const [emailChangeErr, setEmailChangeErr] = useState('')
  const [emailChanging,  setEmailChanging]  = useState(false)
  // A change already requested and waiting on the new address to confirm.
  const [pendingEmail,   setPendingEmail]   = useState<{ newEmail: string; expiresAt: string } | null>(null)
  const [cancellingEmail, setCancellingEmail] = useState(false)

  // Email marketing. Until /me answers we don't know whether this member
  // unsubscribed, so the toggle stays disabled rather than showing "on".
  const [emailMarketing,       setEmailMarketing]       = useState(true)
  const [emailMarketingLoaded, setEmailMarketingLoaded] = useState(false)
  const [emailSaving,          setEmailSaving]          = useState(false)

  // "Open to…" availability flags — surfaced on member cards + filterable on
  // /members. Helps willing matches discover each other without cold messages.
  const [openToCoffee,   setOpenToCoffee]   = useState(false)
  const [openToLanguage, setOpenToLanguage] = useState(false)
  const [openToHosting,  setOpenToHosting]  = useState(false)
  const [openSaving,     setOpenSaving]     = useState<'openToCoffee' | 'openToLanguage' | 'openToHosting' | null>(null)

  const loadPrefs = useCallback(async () => {
    setPrefsState('loading')
    try {
      const res = await fetch('/app/api/notifications/preferences', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const merged = { ...DEFAULT_PREFS, ...pickPrefs(await res.json()) }
      serverPrefs.current = merged
      setPrefs(merged)
      setPrefsState('ready')
    } catch {
      setPrefsState('error')
    }
  }, [])

  const loadPendingEmail = useCallback(async () => {
    try {
      const res = await fetch('/app/api/auth/update-email', { credentials: 'include' })
      if (!res.ok) return
      const d = await res.json().catch(() => null)
      setPendingEmail(d?.pending?.newEmail ? { newEmail: d.pending.newEmail, expiresAt: d.pending.expiresAt } : null)
    } catch {}
  }, [])

  useEffect(() => {
    loadPrefs()
    loadPendingEmail()

    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        // /me now carries emailMarketing. Before it did, this toggle showed
        // "on" to everyone — including members who had unsubscribed — and
        // saved that back the moment they touched anything.
        if (d?.emailMarketing !== undefined) { setEmailMarketing(!!d.emailMarketing); setEmailMarketingLoaded(true) }
        if (d?.openToCoffee   !== undefined) setOpenToCoffee(d.openToCoffee)
        if (d?.openToLanguage !== undefined) setOpenToLanguage(d.openToLanguage)
        if (d?.openToHosting  !== undefined) setOpenToHosting(d.openToHosting)
      })
      .catch(() => {})
  }, [loadPrefs, loadPendingEmail])

  async function saveOpenFlag(key: 'openToCoffee' | 'openToLanguage' | 'openToHosting', value: boolean) {
    if (openSaving) return
    if (key === 'openToCoffee')   setOpenToCoffee(value)
    if (key === 'openToLanguage') setOpenToLanguage(value)
    if (key === 'openToHosting')  setOpenToHosting(value)
    setOpenSaving(key)
    try {
      const res = await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      if (res.ok) {
        toast.success(value ? 'Saved — you’ll appear in this filter' : 'Saved')
      } else {
        // Roll back the optimistic flip so the UI matches DB reality.
        if (key === 'openToCoffee')   setOpenToCoffee(!value)
        if (key === 'openToLanguage') setOpenToLanguage(!value)
        if (key === 'openToHosting')  setOpenToHosting(!value)
        toast.error('Could not save — try again')
      }
    } catch {
      if (key === 'openToCoffee')   setOpenToCoffee(!value)
      if (key === 'openToLanguage') setOpenToLanguage(!value)
      if (key === 'openToHosting')  setOpenToHosting(!value)
      toast.error('Network error')
    } finally {
      setOpenSaving(null)
    }
  }

  async function handleEmailChange() {
    setEmailChangeErr('')
    if (!newEmail.trim()) { setEmailChangeErr('Email is required'); return }
    // The Update button isn't inside a <form>, so type="email" never
    // validated anything — a typo went to the server, spent one of the three
    // hourly attempts and came back as a generic failure.
    if (!EMAIL_RE.test(newEmail.trim())) { setEmailChangeErr('That doesn’t look like an email address'); return }
    if (newEmail.trim().toLowerCase() === (user.email ?? '').toLowerCase()) {
      setEmailChangeErr('That’s already your email address'); return
    }
    if (!emailPassword)   { setEmailChangeErr('Password is required'); return }
    setEmailChanging(true)
    try {
      const res = await fetch('/app/api/auth/update-email', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: emailPassword, code: emailTotp || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 2FA-enrolled accounts must also confirm with a TOTP code — the API
        // signals this with the machine-readable 'code_required' marker and
        // we reveal the input rather than showing it to everyone up front.
        if (data.error === 'code_required') {
          setEmailNeedsTotp(true)
          setEmailChangeErr('Enter a 6-digit code from your authenticator app to confirm.')
          return
        }
        setEmailChangeErr(data.error ?? 'Failed')
        return
      }
      const sentTo = newEmail.trim()
      setNewEmail(''); setEmailPassword(''); setEmailTotp(''); setEmailNeedsTotp(false)
      // Nothing has changed yet: the new address has to confirm it first.
      toast.success(`Check ${sentTo} for a link to confirm — you'll keep signing in with your current email until you click it.`, { duration: 8000 })
      loadPendingEmail()
    } catch { setEmailChangeErr('Something went wrong') }
    finally { setEmailChanging(false) }
  }

  async function cancelPendingEmail() {
    setCancellingEmail(true)
    try {
      const res = await fetch('/app/api/auth/update-email', { method: 'DELETE', credentials: 'include' })
      if (!res.ok) { toast.error('Could not cancel that change — try again'); return }
      setPendingEmail(null)
      toast.success('Email change cancelled — you keep your current address')
    } catch {
      toast.error('Could not cancel that change — check your connection')
    } finally {
      setCancellingEmail(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return }
    if (newPw.length < 8)    { setPwError('Password must be at least 8 characters'); return }
    setPwError('')
    setPwStatus('saving')
    try {
      const res = await fetch('/app/api/auth/change-password', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: newPw, code: pwTotp || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setPwStatus('ok')
        setCurrent(''); setNewPw(''); setConfirmPw('')
        setPwTotp(''); setPwNeedsTotp(false)
        // Changing the password ends any email change waiting to be
        // confirmed, so the banner shouldn't keep claiming one is in flight.
        setPendingEmail(null)
        // It also drops every push registration on the account, this browser's
        // included: forget the sync stamp so this device registers again on
        // the next page load rather than showing On and hearing nothing.
        forgetPushSync()
        setTimeout(() => setPwStatus('idle'), 3000)
      } else if (data.error === 'code_required') {
        // Same machine-readable marker as the email change: reveal the code
        // input for 2FA accounts rather than showing it to everyone.
        setPwNeedsTotp(true)
        setPwError('Enter a 6-digit code from your authenticator app to confirm.')
        setPwStatus('error')
      } else {
        setPwError(data.error ?? 'Something went wrong')
        setPwStatus('error')
      }
    } catch {
      // A dropped connection or an HTML 502 used to leave the button on
      // "Saving…" until a reload.
      setPwError('Could not reach the server — try again')
      setPwStatus('error')
    }
  }

  async function savePref(key: keyof Prefs, value: boolean | number) {
    // Nothing is saved from a screen that never loaded the member's real
    // settings, and one save at a time — two in flight and the loser's
    // rollback wrote the other one's field back.
    if (prefsState !== 'ready' || savingPref) return
    setPrefs(p => ({ ...p, [key]: value } as Prefs))
    setSavingPref(key)
    try {
      // Only the changed key. The route destructures known keys and skips
      // undefined ones, so a partial is a partial update — and a stale copy
      // of the other eight can't ride along and undo a save from another tab.
      const res = await fetch('/app/api/notifications/preferences', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      if (res.ok) {
        const merged = { ...serverPrefs.current, ...pickPrefs(await res.json().catch(() => null)), [key]: value } as Prefs
        serverPrefs.current = merged
        setPrefs(merged)
        toast.success('Saved')
        setPrefsOk(true)
        setTimeout(() => setPrefsOk(false), 2000)
      } else {
        setPrefs(p => ({ ...p, [key]: serverPrefs.current[key] } as Prefs))
        toast.error('Could not save — try again')
      }
    } catch {
      setPrefs(p => ({ ...p, [key]: serverPrefs.current[key] } as Prefs))
      toast.error('Network error')
    } finally {
      setSavingPref(null)
    }
  }

  // Equal bounds are not a 24-hour mute — lib/notify reads from === to as no
  // quiet window at all, so a member who set 22 to 22 would keep getting
  // pushes while the screen said they were muted. Refuse the pair instead.
  function saveQuietBound(key: 'quietFrom' | 'quietTo', value: number) {
    const other = key === 'quietFrom' ? prefs.quietTo : prefs.quietFrom
    if (value === other) {
      toast.error('Quiet hours need a start and an end that differ — the same hour for both means no quiet hours at all.')
      return
    }
    savePref(key, value)
  }

  async function saveEmailMarketingWithToast(value: boolean) {
    if (!emailMarketingLoaded) return
    const prev = emailMarketing
    setEmailMarketing(value)
    setEmailSaving(true)
    try {
      const res = await fetch('/app/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailMarketing: value }),
      })
      if (res.ok) toast.success('Saved')
      else { setEmailMarketing(prev); toast.error('Could not save — try again') }
    } catch {
      setEmailMarketing(prev)
      toast.error('Network error')
    } finally {
      setEmailSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-4">
          <div className="max-w-xl">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Settings</h1>
          <p className="text-base text-gray-600 mt-1">Manage your account and preferences</p>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-xl space-y-5">

        {/* Change password */}
        <Section title="Change Password" description="Use a strong password you don't use elsewhere">
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label htmlFor="current-password" className="block text-xs font-medium text-gray-600 mb-1">Current password</label>
              <div className="relative">
                <input id="current-password" name="current-password" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                  value={current} onChange={e => setCurrent(e.target.value)} required
                  className="input pr-12" />
                <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
              </div>
            </div>
            <div>
              <label htmlFor="new-password" className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <div className="relative">
                <input id="new-password" name="new-password" type={showPw ? 'text' : 'password'} autoComplete="new-password"
                  value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8}
                  className="input pr-12" />
                <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
              </div>
              <p className="text-xs text-gray-400 mt-1">At least 8 characters.</p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
              <div className="relative">
                <input id="confirm-password" name="confirm-password" type={showPw ? 'text' : 'password'} autoComplete="new-password"
                  value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required
                  className="input pr-12" />
                <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
              </div>
            </div>
            {pwNeedsTotp && (
              <div>
                <label htmlFor="password-totp" className="block text-xs font-medium text-gray-600 mb-1">Code from your authenticator app</label>
                <input id="password-totp" name="password-totp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={pwTotp} onChange={e => setPwTotp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="input text-center tracking-widest" />
              </div>
            )}
            {pwError && <p className="text-xs text-red-500">{pwError}</p>}
            <button type="submit" disabled={pwStatus === 'saving' || (pwNeedsTotp && pwTotp.length !== 6)}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
              {pwStatus === 'saving' ? 'Saving…' : pwStatus === 'ok' ? '✓ Password updated' : 'Update password'}
            </button>
            <p className="text-xs text-gray-400">
              Changing your password signs out your other devices and cancels any email change waiting to be confirmed.
            </p>
          </form>
        </Section>

        {/* Notification preferences. The descriptions name everything each
            switch actually gates (lib/notify's PREF_KEY map) — they used to
            each describe one of the several types they mute, so members
            turned off "New events" and stopped hearing about new articles
            without ever being told they would. */}
        <Section id="notifications" title="Notifications" description={savingPref ? 'Saving…' : prefsOk ? '✓ Saved' : 'Choose what you hear about'}>
          {prefsState === 'error' ? (
            <div className="space-y-2">
              <p className="text-sm text-red-600">
                We couldn&apos;t load your notification settings, so they&apos;re hidden rather than shown wrong —
                switching one now would save over whatever you actually chose.
              </p>
              <button
                type="button"
                onClick={loadPrefs}
                className="text-sm font-semibold text-amber-600 hover:text-amber-700"
              >
                Retry
              </button>
            </div>
          ) : prefsState === 'loading' ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : (
          <div className="divide-y divide-gray-50">
            <Toggle label="New events" description="New events, hangouts near you, new articles, and connections posting they're free to meet"
              checked={prefs.newEvents} disabled={savingPref === 'newEvents'} onChange={v => savePref('newEvents', v)} />
            <Toggle label="Event reminders" description="Reminders before an event you joined, the day-before “still coming?” (no answer can release your seat), and the review request after"
              checked={prefs.reminders} disabled={savingPref === 'reminders'} onChange={v => savePref('reminders', v)} />
            <Toggle label="Event updates" description="Changes to events you're attending"
              checked={prefs.eventUpdates} disabled={savingPref === 'eventUpdates'} onChange={v => savePref('eventUpdates', v)} />
            <Toggle label="New attendees" description="When someone joins your event or hangout — and the event's chat messages and photos"
              checked={prefs.joinedEvents} disabled={savingPref === 'joinedEvents'} onChange={v => savePref('joinedEvents', v)} />
            <Toggle label="Club wall posts" description="New posts in clubs you've joined"
              checked={prefs.wallPosts} disabled={savingPref === 'wallPosts'} onChange={v => savePref('wallPosts', v)} />
            <Toggle label="Wall replies" description="Replies to your club posts, and replies and interest on your board posts"
              checked={prefs.wallReplies} disabled={savingPref === 'wallReplies'} onChange={v => savePref('wallReplies', v)} />
            <Toggle
              label="Quiet hours"
              description={`Hold push notifications from ${String(prefs.quietFrom).padStart(2, '0')}:00 to ${String(prefs.quietTo).padStart(2, '0')}:00`}
              checked={prefs.quietHours}
              disabled={savingPref === 'quietHours'}
              onChange={v => savePref('quietHours', v)}
            />
            {prefs.quietHours && (
              <div className="py-2 pl-1 space-y-2">
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <label htmlFor="quiet-from" className="text-xs text-gray-600 w-10">From</label>
                    <select id="quiet-from" value={prefs.quietFrom} disabled={savingPref === 'quietFrom'}
                      onChange={e => saveQuietBound('quietFrom', Number(e.target.value))}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50">
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i} disabled={i === prefs.quietTo}>{String(i).padStart(2,'0')}:00</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="quiet-to" className="text-xs text-gray-600 w-6">To</label>
                    <select id="quiet-to" value={prefs.quietTo} disabled={savingPref === 'quietTo'}
                      onChange={e => saveQuietBound('quietTo', Number(e.target.value))}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50">
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i} disabled={i === prefs.quietFrom}>{String(i).padStart(2,'0')}:00</option>)}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Quiet hours drop the push only — the notification is still waiting in your bell when
                  you next look, and emails arrive as usual. A few time-critical ones (a hangout about
                  to start, a seat that just opened) still ping. The clock is your home city&apos;s
                  {homeCityName ? ` (${homeCityName})` : ''}, not your phone&apos;s.
                </p>
              </div>
            )}
          </div>
          )}
        </Section>

        <PushNotificationsSection userId={user.id} />

        {/* Home city — the "I moved" flow */}
        <Section title="Home city" description="Where your feeds, events and clubs point by default">
          <HomeCitySection staff={user.role === 'admin' || user.role === 'moderator'} />
        </Section>

        {/* Open to… flags */}
        <Section title="Open to…" description="Shown as small badges on your member card so people know what you’re up for.">
          <Toggle
            label="☕ Coffee with newcomers"
            description="New arrivals and visitors can reach out for an intro coffee."
            checked={openToCoffee}
            disabled={openSaving === 'openToCoffee'}
            onChange={v => saveOpenFlag('openToCoffee', v)}
          />
          <Toggle
            label="🗣️ Language exchange"
            description="Trade an hour of your language for theirs."
            checked={openToLanguage}
            disabled={openSaving === 'openToLanguage'}
            onChange={v => saveOpenFlag('openToLanguage', v)}
          />
          <Toggle
            label="🏠 Hosting visitors"
            description="Show visiting members around your neighborhood."
            checked={openToHosting}
            disabled={openSaving === 'openToHosting'}
            onChange={v => saveOpenFlag('openToHosting', v)}
          />
          {openSaving && <p className="text-xs text-gray-400 mt-2">Saving…</p>}
        </Section>

        {/* Email preferences */}
        <Section title="Email Preferences" description="Control marketing emails from Smileys">
          <Toggle
            label="Broadcast emails"
            description="Announcements, newsletters, and community updates"
            checked={emailMarketing}
            disabled={!emailMarketingLoaded || emailSaving}
            onChange={saveEmailMarketingWithToast}
          />
          {emailSaving && <p className="text-xs text-gray-400 mt-2">Saving…</p>}
        </Section>

        {/* Two-factor authentication. Enrollment is admin/moderator-only
            today — but anyone who is ENROLLED needs this section whatever
            their role is now: a moderator who was demoted still gets asked
            for a code at every login, and had nowhere to turn it off or to
            replace recovery codes they'd used up. */}
        {(user.role === 'admin' || user.role === 'moderator' || user.totpEnabled) && (
          <Section
            title="Two-factor authentication"
            description={user.role === 'admin' || user.role === 'moderator'
              ? 'Recommended for admin / moderator roles'
              : 'Your account asks for a code at every sign-in'}
          >
            <TwoFactorSection show={true} canEnroll={user.role === 'admin' || user.role === 'moderator'} />
          </Section>
        )}

        {/* Active devices — applies to everyone. Lets users spot a stolen
            cookie / shared device and sign it out without forcing the
            global tokenVersion bump. */}
        <Section title="Active devices" description="Sign out a device if you don't recognize it">
          <ActiveDevicesSection />
        </Section>

        {/* Account */}
        <Section title="Account">
          <div className="space-y-3">
            {/* A long address used to push the badge off the right edge of a
                320px screen — the row is a two-column grid now and the
                address wraps inside its own column. */}
            <div className="grid grid-cols-[auto_1fr] items-start gap-3 text-sm">
              <span className="text-gray-600 pt-0.5">Email</span>
              <span className="text-gray-700 font-medium text-right break-all min-w-0">{user.email}
                {user.emailVerified
                  ? <span className="ml-2 inline-block text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full align-middle">Verified</span>
                  : <span className="ml-2 inline-block text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full align-middle">Unverified</span>}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Role</span>
              <span className="capitalize text-gray-700 font-medium">{user.role}</span>
            </div>
          </div>
        </Section>

        {/* Change email — ported from /profile so password, email, and
            delete-account all live on this page. */}
        <Section title="Change email address" description="Requires your password; the new address gets a verification email">
          <div className="space-y-2">
            {/* A change already asked for. Without this the page looked
                untouched while a confirmation link sat in another inbox —
                and there was no way to call it off. */}
            {pendingEmail && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-1.5">
                <p className="text-xs text-amber-900 leading-relaxed break-all">
                  Waiting for you to confirm at <span className="font-semibold">{pendingEmail.newEmail}</span>
                  {' — '}the link expires {formatExpiry(pendingEmail.expiresAt, city?.timezone)}.
                </p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  You keep signing in with {user.email} until you click it. Changing your password also cancels it.
                </p>
                <button
                  type="button"
                  onClick={cancelPendingEmail}
                  disabled={cancellingEmail}
                  className="text-xs font-semibold text-amber-900 underline disabled:opacity-50"
                >
                  {cancellingEmail ? 'Cancelling…' : 'Cancel this change'}
                </button>
              </div>
            )}
            {emailChangeErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{emailChangeErr}</p>}
            <label htmlFor="new-email" className="sr-only">New email address</label>
            <input id="new-email" name="new-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              autoComplete="email" placeholder="New email address"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <label htmlFor="email-password" className="sr-only">Confirm with password</label>
                <input id="email-password" name="email-password" type={showEmailPw ? 'text' : 'password'} value={emailPassword} onChange={e => setEmailPassword(e.target.value)}
                  autoComplete="current-password" placeholder="Confirm with password"
                  className="w-full px-4 py-2.5 pr-12 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <PasswordToggle visible={showEmailPw} onToggle={() => setShowEmailPw(p => !p)} />
              </div>
              {emailNeedsTotp && (
                <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Code from your authenticator app"
                  value={emailTotp} onChange={e => setEmailTotp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full sm:w-32 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-400" />
              )}
              <button onClick={handleEmailChange} disabled={emailChanging || !newEmail.trim() || !emailPassword || (emailNeedsTotp && emailTotp.length !== 6)}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {emailChanging ? 'Saving…' : 'Update email'}
              </button>
            </div>
          </div>
        </Section>

        {/* Delete account — wired to the now-complete cascade route. */}
        <Section title="Delete account" description="Permanent. Cannot be undone.">
          <DeleteAccountSection />
        </Section>
        </div>
      </div>
    </div>
  )
}
