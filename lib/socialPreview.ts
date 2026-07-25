// Ask Facebook to (re)scrape an article's Open Graph tags so the FIRST time
// the link is shared, the preview shows the current title/image instead of a
// stale or empty cache. Facebook caches aggressively (~7-30 days), so without
// this the fix-then-share loop needs a manual pass through the Sharing Debugger.
//
// No-op unless FACEBOOK_APP_TOKEN is set — the feature is optional and fails
// closed. To activate: create a Facebook app (developers.facebook.com), take
// its App Token (app_id|app_secret) or a long-lived token, and set
// FACEBOOK_APP_TOKEN in the server .env.local. Best-effort: any error is
// swallowed so a Facebook outage never affects publishing.
export async function refreshFacebookPreview(pageUrl: string): Promise<void> {
  const token = process.env.FACEBOOK_APP_TOKEN
  if (!token) return
  try {
    const api = `https://graph.facebook.com/v21.0/?id=${encodeURIComponent(pageUrl)}&scrape=true&access_token=${encodeURIComponent(token)}`
    await fetch(api, { method: 'POST' })
  } catch {
    // Best-effort — a failed re-scrape just means the first share may show a
    // stale preview until Facebook's cache expires or someone re-scrapes by hand.
  }
}
