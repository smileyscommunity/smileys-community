import { redirect } from 'next/navigation'

// This route was misnamed — it contained announcements + polls (comms tools),
// not engagement analytics. Moved to /admin/announcements; keep this as a
// redirect so existing bookmarks and any external links still resolve.
//
// The ?tab= param is preserved by clients; Next.js's redirect() doesn't carry
// query string, so we read it from the URL via headers in a server component.
// Simpler: redirect to the bare page (tab will fall back to 'announcement').
export default function EngagementRedirect() {
  redirect('/admin/announcements')
}
