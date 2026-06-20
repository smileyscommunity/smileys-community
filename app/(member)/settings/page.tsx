'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import ActiveDevicesSection from '@/components/settings/ActiveDevicesSection'
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

function PushNotificationsSection() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'denied' | 'off' | 'on'>('loading')
  const [busy,  setBusy]  = useState(false)

  const check = useCallback(async () => {
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') { setState('denied'); return }
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    setState(sub ? 'on' : 'off')
  }, [])

  useEffect(() => { check() }, [check])

  async function enable() {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState('denied'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
      await fetch('/app/api/push/subscribe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      setState('on')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/app/api/push/subscribe', {
          method: 'DELETE', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading' || state === 'unsupported') return null

  return (
    <Section title="Push Notifications" description="Get notified on this device even when the app is closed">
      {state === 'denied' ? (
        <p className="text-xs text-gray-600">
          Notifications are blocked in your browser. To enable, open your browser settings and allow notifications for this site.
        </p>
      ) : (
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div>
            <p className="text-sm font-medium text-gray-800">Push notifications</p>
            <p className="text-xs text-gray-400 mt-0.5">Events, RSVPs, and club activity on this device</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={state === 'on' ? disable : enable}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${state === 'on' ? 'bg-amber-500' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${state === 'on' ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      )}
    </Section>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${checked ? 'bg-amber-500' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()

  // Password
  const [current,   setCurrent]   = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [pwStatus,  setPwStatus]  = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [pwError,   setPwError]   = useState('')

  // Notification prefs
  const [prefs, setPrefs] = useState({
    newEvents: true, reminders: true, eventUpdates: true,
    joinedEvents: true, wallPosts: true, wallReplies: true,
    quietHours: false, quietFrom: 23, quietTo: 9,
  })
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsOk,     setPrefsOk]     = useState(false)

  // Email marketing
  const [emailMarketing,    setEmailMarketing]    = useState(true)
  const [emailSaving,       setEmailSaving]       = useState(false)

  // "Open to…" availability flags — surfaced on member cards + filterable on
  // /members. Helps willing matches discover each other without cold messages.
  const [openToCoffee,   setOpenToCoffee]   = useState(false)
  const [openToLanguage, setOpenToLanguage] = useState(false)
  const [openToHosting,  setOpenToHosting]  = useState(false)
  const [openSaving,     setOpenSaving]     = useState(false)

  useEffect(() => {
    fetch('/app/api/notifications/preferences', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d) setPrefs(p => ({ ...p, ...d }))
      }).catch(() => {})

    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d?.emailMarketing !== undefined) setEmailMarketing(d.emailMarketing)
        if (d?.openToCoffee   !== undefined) setOpenToCoffee(d.openToCoffee)
        if (d?.openToLanguage !== undefined) setOpenToLanguage(d.openToLanguage)
        if (d?.openToHosting  !== undefined) setOpenToHosting(d.openToHosting)
      })
      .catch(() => {})
  }, [])

  async function saveOpenFlag(key: 'openToCoffee' | 'openToLanguage' | 'openToHosting', value: boolean) {
    if (key === 'openToCoffee')   setOpenToCoffee(value)
    if (key === 'openToLanguage') setOpenToLanguage(value)
    if (key === 'openToHosting')  setOpenToHosting(value)
    setOpenSaving(true)
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
      setOpenSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return }
    if (newPw.length < 8)    { setPwError('Password must be at least 8 characters'); return }
    setPwError('')
    setPwStatus('saving')
    const res = await fetch('/app/api/auth/change-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
    })
    const data = await res.json()
    if (res.ok) {
      setPwStatus('ok')
      setCurrent(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => setPwStatus('idle'), 3000)
    } else {
      setPwError(data.error ?? 'Something went wrong')
      setPwStatus('error')
    }
  }

  async function savePref(key: string, value: boolean | number) {
    const previous = prefs
    const updated = { ...prefs, [key]: value }
    setPrefs(updated as typeof prefs)
    setPrefsSaving(true)
    try {
      const res = await fetch('/app/api/notifications/preferences', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (res.ok) {
        toast.success('Saved')
        setPrefsOk(true)
        setTimeout(() => setPrefsOk(false), 2000)
      } else {
        setPrefs(previous)
        toast.error('Could not save — try again')
      }
    } catch {
      setPrefs(previous)
      toast.error('Network error')
    } finally {
      setPrefsSaving(false)
    }
  }

  async function saveEmailMarketingWithToast(value: boolean) {
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
        <div className="max-w-xl mx-auto px-4 sm:px-6 pt-10 pb-4">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Settings</h1>
          <p className="text-base text-gray-600 mt-1">Manage your account and preferences</p>
        </div>
      </div>
      <div className="max-w-xl mx-auto px-4 py-8 space-y-5">

        {/* Change password */}
        <Section title="Change Password" description="Use a strong password you don't use elsewhere">
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Current password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)} required
                  className="input pr-12" />
                <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8}
                  className="input pr-12" />
                <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
              </div>
              <p className="text-xs text-gray-400 mt-1">At least 8 characters.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required
                  className="input pr-12" />
                <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
              </div>
            </div>
            {pwError && <p className="text-xs text-red-500">{pwError}</p>}
            <button type="submit" disabled={pwStatus === 'saving'}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
              {pwStatus === 'saving' ? 'Saving…' : pwStatus === 'ok' ? '✓ Password updated' : 'Update password'}
            </button>
          </form>
        </Section>

        {/* Notification preferences */}
        <Section title="Notifications" description={prefsSaving ? 'Saving…' : prefsOk ? '✓ Saved' : 'Choose what you hear about'}>
          <div className="divide-y divide-gray-50">
            <Toggle label="New events" description="When new events are published" checked={prefs.newEvents} onChange={v => savePref('newEvents', v)} />
            <Toggle label="Event reminders" description="24-hour reminder before events you've joined" checked={prefs.reminders} onChange={v => savePref('reminders', v)} />
            <Toggle label="Event updates" description="Changes to events you're attending" checked={prefs.eventUpdates} onChange={v => savePref('eventUpdates', v)} />
            <Toggle label="New attendees" description="When someone joins your event" checked={prefs.joinedEvents} onChange={v => savePref('joinedEvents', v)} />
            <Toggle label="Club wall posts" description="New posts in clubs you've joined" checked={prefs.wallPosts} onChange={v => savePref('wallPosts', v)} />
            <Toggle label="Wall replies" description="Replies to your club posts" checked={prefs.wallReplies} onChange={v => savePref('wallReplies', v)} />
            <Toggle label="Quiet hours" description={`Mute notifications from ${prefs.quietFrom}:00 to ${prefs.quietTo}:00`} checked={prefs.quietHours} onChange={v => savePref('quietHours', v)} />
            {prefs.quietHours && (
              <div className="flex flex-wrap gap-3 py-2 pl-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 w-10">From</label>
                  <select value={prefs.quietFrom} onChange={e => savePref('quietFrom', Number(e.target.value))}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400">
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2,'0')}:00</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 w-6">To</label>
                  <select value={prefs.quietTo} onChange={e => savePref('quietTo', Number(e.target.value))}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400">
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2,'0')}:00</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </Section>

        <PushNotificationsSection />

        {/* Open to… flags */}
        <Section title="Open to…" description="Shown as small badges on your member card so people know what you’re up for.">
          <Toggle
            label="☕ Coffee with newcomers"
            description="New arrivals and visitors can reach out for an intro coffee."
            checked={openToCoffee}
            onChange={v => saveOpenFlag('openToCoffee', v)}
          />
          <Toggle
            label="🗣️ Language exchange"
            description="Trade an hour of your language for theirs."
            checked={openToLanguage}
            onChange={v => saveOpenFlag('openToLanguage', v)}
          />
          <Toggle
            label="🏠 Hosting visitors"
            description="Show visiting members around your neighborhood."
            checked={openToHosting}
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
            onChange={saveEmailMarketingWithToast}
          />
          {emailSaving && <p className="text-xs text-gray-400 mt-2">Saving…</p>}
        </Section>

        {/* Two-factor authentication. Enrollment is admin/moderator-only
            today, so members see no UI here. */}
        {(user.role === 'admin' || user.role === 'moderator') && (
          <Section title="Two-factor authentication" description="Required for admin / moderator roles">
            <TwoFactorSection show={true} />
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
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Email</span>
              <span className="text-gray-700 font-medium">{user.email}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Role</span>
              <span className="capitalize text-gray-700 font-medium">{user.role}</span>
            </div>
          </div>
        </Section>

        {/* Delete account — wired to the now-complete cascade route. */}
        <Section title="Delete account" description="Permanent. Cannot be undone.">
          <DeleteAccountSection />
        </Section>
      </div>
    </div>
  )
}
