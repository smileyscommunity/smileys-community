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
// v9: 2026-06-02 — Security audit round 2: cross-club post IDOR
//                  fixes, admin events city scope, hangout chat
//                  membership gate, email HTML-escape, JSON-LD
//                  </script> escape, URL protocol allowlist on
//                  banners/sponsors/partners, contact-form auto-
//                  reply removed, HSTS header added.
// v10: 2026-06-02 — Round 3: moderator city scope on broadcast +
//                  events POST + approval queue + messages list,
//                  cross-neighborhood reply/like scoping, cron
//                  timingSafeEqual, 2FA enrollment opened to
//                  moderators, SW clears auth-bearing cache on
//                  logout (shared-device cross-user leak).
// v11: 2026-06-02 — Round 4: CSP migrated to nonce + strict-dynamic
//                  via middleware. Modern browsers now block any
//                  injected inline <script> without a valid
//                  per-request nonce — closes the unsafe-inline
//                  XSS-bypass gap.
// v12: 2026-06-02 — CSP report-uri added — browsers POST blocked-
//                  resource reports to /api/csp-report so we catch
//                  silent CSP regressions before users notice.
// v13: 2026-06-03 — Auth-API caching disabled. Network-first cache of
//                  /api/events/attending could leak User A's events
//                  to User B on a shared device (inflight cache.put
//                  racing with logout's clear-auth-cache message,
//                  and SW controller null on first visit). The
//                  offline /my-events benefit isn't worth the leak.
//                  OFFLINE_APIS is now empty; the activate handler
//                  below evicts every old cached entry on this bump.
// v14: 2026-07-11 — Force-evict stale cached chunks: a device kept
//                  rendering the pre-feed /admin/participants page
//                  through multiple deploys despite full reloads.
// v15: 2026-07-31 — Event photo gallery resize (grid → single scrollable
//                  row of smaller thumbnails) wasn't showing on returning
//                  visitors — evict the cached EventPhotos chunk.
// v16: 2026-07-31 — Real root cause of "photos still big" was inline
//                  <img> tags pasted into event rich-text descriptions
//                  (unrelated to EventPhotos), capped via .rich-content
//                  img in globals.css. Evict cached CSS bundle.
const CACHE = 'smileys-v16'

// API endpoints to cache for offline use. Empty by design — see v13 note.
// Auth-bearing responses MUST NOT be cached in this shared CACHE because
// the SW has no concept of "current user" and can't isolate entries per
// session. If a future offline-mode feature is needed, scope it to a
// per-user cache name (e.g. `auth-${userId}`) generated at login.
const OFFLINE_APIS = []

self.addEventListener('install', () => self.skipWaiting())

// Auth-scoped cache eviction on logout. The fetch handler below caches
// /app/api/events/attending for offline use, but that response is
// user-specific — on a shared device, after user A signs out and user B
// signs in, B's first offline-mode load would otherwise return A's events.
// The AuthContext.logout() handler posts `{ type: 'clear-auth-cache' }`
// to the active SW; we drop every cached entry under OFFLINE_APIS here.
self.addEventListener('message', e => {
  if (e.data?.type === 'clear-auth-cache') {
    e.waitUntil(
      caches.open(CACHE).then(async cache => {
        const keys = await cache.keys()
        for (const req of keys) {
          const url = new URL(req.url)
          if (OFFLINE_APIS.some(p => url.pathname === p)) {
            await cache.delete(req)
          }
        }
      })
    )
  }
})

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
