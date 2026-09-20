import { redirect } from 'next/navigation'

// The preferences live in one section of a long settings page, so land on it
// rather than at the top — the bell's gear used to drop members at "Profile"
// with no sign of what they'd come for.
export default function NotificationSettingsRedirect() {
  redirect('/settings#notifications')
}
