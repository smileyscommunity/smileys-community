'use client'

import { useEffect, useState } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function subscribe(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })

  const res = await fetch('/app/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })

  return res.ok
}

// "Not now" used to live in component state only, so every cold start of
// the installed app (and every city switch, which reloads) re-showed the
// card after 8s. The dismissal is remembered per browser for a month; the
// subscription re-sync runs at most daily instead of on every mount.
const DISMISS_KEY   = 'smileys_push_prompt_dismissed_at'
const SYNCED_KEY    = 'smileys_push_synced_at'
const DISMISS_FOR   = 30 * 24 * 60 * 60_000
const RESYNC_AFTER  = 24 * 60 * 60_000

// localStorage can throw (private mode, blocked site data) — a prompt must
// never take the page down with it.
function readStamp(key: string): number {
  try { return Number(localStorage.getItem(key) ?? 0) || 0 } catch { return 0 }
}
function writeStamp(key: string): void {
  try { localStorage.setItem(key, String(Date.now())) } catch {}
}

export default function PushPermission() {
  const [state, setState] = useState<'idle' | 'prompt' | 'subscribed' | 'denied' | 'unsupported'>('idle')

  useEffect(() => {
    if (!('Notification' in window) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'granted') {
      if (Date.now() - readStamp(SYNCED_KEY) > RESYNC_AFTER) {
        subscribe().then(ok => { if (ok) writeStamp(SYNCED_KEY) }).catch(() => {})
      }
      setState('subscribed')
    } else if (Notification.permission === 'denied') {
      setState('denied')
    } else if (Date.now() - readStamp(DISMISS_KEY) < DISMISS_FOR) {
      setState('denied')
    } else {
      // Show prompt after a short delay so it doesn't appear on first load
      const t = setTimeout(() => setState('prompt'), 8000)
      return () => clearTimeout(t)
    }
  }, [])

  async function handleAllow() {
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      const ok = await subscribe().catch(() => false)
      if (ok) writeStamp(SYNCED_KEY)
      setState('subscribed')
    } else {
      setState('denied')
    }
  }

  function handleDismiss() {
    writeStamp(DISMISS_KEY)
    setState('denied')
  }

  if (state !== 'prompt') return null

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 md:left-auto md:right-6 md:w-80">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0">🔔</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm">Stay in the loop</p>
            <p className="text-gray-600 text-xs mt-0.5">Get notified about events, RSVPs, and club activity.</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAllow}
                className="flex-1 bg-amber-400 hover:bg-amber-500 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors"
              >
                Allow
              </button>
              <button
                onClick={handleDismiss}
                className="flex-1 text-gray-400 hover:text-gray-600 text-xs py-1.5 rounded-lg transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
