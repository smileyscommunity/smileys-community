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

export default function PushPermission() {
  const [state, setState] = useState<'idle' | 'prompt' | 'subscribed' | 'denied' | 'unsupported'>('idle')

  useEffect(() => {
    if (!('Notification' in window) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'granted') {
      subscribe().catch(() => {})
      setState('subscribed')
    } else if (Notification.permission === 'denied') {
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
      await subscribe()
      setState('subscribed')
    } else {
      setState('denied')
    }
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
                onClick={() => setState('denied')}
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
