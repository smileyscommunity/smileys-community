// Device-level push bookkeeping shared by the push prompt and the logout
// path. It lives here rather than in components/PushPermission so the auth
// context can tear a device down without importing a UI component.

// Last successful re-sync of this browser's subscription, and WHICH member it
// was synced for — the daily gate is per member, not per browser.
export const PUSH_SYNCED_KEY      = 'smileys_push_synced_at'
export const PUSH_SYNCED_USER_KEY = 'smileys_push_synced_user'

// This browser said no. Turning the /settings toggle off unsubscribes the
// device, but nothing recorded the refusal — so the prompt's re-sync
// subscribed it again on the next page load and the toggle appeared to turn
// itself back on. Same class of trap as the stamps above, so it lives with
// them: a refusal is device state, not account state.
//
// Deliberately NOT cleared on logout. The member who switched it off is
// telling us about this phone; signing out and back in isn't them changing
// their mind. Only turning the toggle on again clears it.
export const PUSH_OPTED_OUT_KEY = 'smileys_push_opted_out'

export function pushOptedOut(): boolean {
  try { return localStorage.getItem(PUSH_OPTED_OUT_KEY) === '1' } catch { return false }
}

export function setPushOptedOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(PUSH_OPTED_OUT_KEY, '1')
    else          localStorage.removeItem(PUSH_OPTED_OUT_KEY)
  } catch {}
}

// Record a successful subscribe the way the prompt's daily gate reads it.
// Without this, enabling push from /settings left the stamps untouched and
// the prompt considered the device "due" on the very next page load.
export function rememberPushSynced(userId: string): void {
  try {
    localStorage.setItem(PUSH_SYNCED_USER_KEY, userId)
    localStorage.setItem(PUSH_SYNCED_KEY, String(Date.now()))
  } catch {}
}

// After a password change or "sign out everywhere else": those delete the
// server's push rows for the account, including this browser's, while the
// browser still holds its subscription — so the toggle reads On and nothing
// arrives. Clearing the sync stamp makes PushPermission register it again on
// the next page load.
export function forgetPushSync(): void {
  try {
    localStorage.removeItem(PUSH_SYNCED_KEY)
    localStorage.removeItem(PUSH_SYNCED_USER_KEY)
  } catch {}
}

// Called on logout, before the session cookie is dropped (the DELETE needs
// it). Best-effort end to end: a sign-out must never hang or fail because a
// push service, the network or a locked-down browser said no.
export async function forgetPushDevice(): Promise<void> {
  // Otherwise the same member signing back in within a day would skip the
  // re-sync against a subscription that no longer exists.
  try {
    localStorage.removeItem(PUSH_SYNCED_KEY)
    localStorage.removeItem(PUSH_SYNCED_USER_KEY)
  } catch {}
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    // getRegistration, not .ready — .ready never settles when no worker was
    // ever registered, and that would hang the logout.
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager?.getSubscription()
    if (!sub) return
    await fetch('/app/api/push/subscribe', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    // Also drop the browser subscription. If the DELETE didn't land (offline,
    // 5xx), killing the endpoint at the push service is what actually stops
    // the previous member's pushes reaching this phone — lib/push prunes the
    // dead row on its next 404/410. It costs the next member nothing: the
    // prompt's re-sync subscribes again with the permission the browser
    // already holds, minting a fresh endpoint under their account.
    await sub.unsubscribe().catch(() => false)
  } catch {}
}
