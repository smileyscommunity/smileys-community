// Bump this version any time the JS/CSS bundle changes in a way
// returning members need to see immediately (UI bug fixes, copy
// fixes with legal implications, etc.). The activate handler
// below deletes any cache key that doesn't match, which evicts
// the old bundle the moment the new SW activates.
//
// v4: 2026-06-02 — RSVPButton modal z-index fix (cancel-spot
//                  buttons hidden under BottomNav on mobile).
// v5: 2026-06-02 — Same bug reported again on v4 (cache hadn't
//                  flushed or Tailwind didn't compile z-[70]).
//                  Belt-and-braces: inline style zIndex 9999 +
//                  items-start on mobile so the modal anchors
//                  high in the viewport regardless.
// v6: 2026-06-02 — Actual root cause found: the cancel modal is
//                  rendered inside the sticky RSVP bar which uses
//                  backdrop-filter, creating a containing block
//                  that trapped the `fixed inset-0` overlay. Fix
//                  is to portal the modal to document.body via
//                  createPortal — escapes the containing block.
// v7: 2026-06-02 — Notifications page header actions stacked on
//                  mobile (was wrapping into 3 lines + clipping
//                  the Settings label next to the 4xl heading).
// v8: 2026-06-02 — Preemptive containing-block-trap audit. Portal
//                  ReportButton and EventPhotos lightbox to
//                  document.body (same fix that solved RSVPButton
//                  cancel modal). Both are reusable components
//                  that can be dropped anywhere — portaling makes
//                  them immune to any future ancestor with
//                  backdrop-filter / transform / filter.
const CACHE = 'smileys-v8'

// API endpoints to cache for offline use (network-first, cache fallback)
const OFFLINE_APIS = ['/app/api/events/attending']

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Only handle same-origin GET requests
  if (url.origin !== location.origin || request.method !== 'GET') return

  // Network-first for My Events API — cache for offline fallback
  if (OFFLINE_APIS.some(p => url.pathname === p)) {
    e.respondWith(
      fetch(request.clone())
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()))
          return res
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached ?? new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
    )
    return
  }

  // Cache-first for static assets — JS, CSS, fonts, images
  const isStatic =
    request.destination === 'script' ||
    request.destination === 'style'  ||
    request.destination === 'font'   ||
    (request.destination === 'image' && !url.pathname.startsWith('/app/api/'))

  if (isStatic) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()))
          return res
        })
      })
    )
  }
})

self.addEventListener('push', e => {
  if (!e.data) return
  let payload
  try { payload = e.data.json() } catch { return }

  const title   = payload.title ?? 'Smileys'
  const options = {
    body:    payload.body  ?? '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    data:    { link: payload.link ?? '/app' },
    vibrate: [100, 50, 100],
  }

  e.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const raw = e.notification.data?.link ?? ''
  // Ensure the link is within the SW scope (/app/)
  const link = raw.startsWith('/app') ? raw : `/app${raw || '/dashboard'}`
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/app') && 'focus' in client) {
          client.focus()
          return client.navigate(link)
        }
      }
      return clients.openWindow(link)
    })
  )
})
