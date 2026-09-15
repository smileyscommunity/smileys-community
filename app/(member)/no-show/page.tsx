import { redirect } from 'next/navigation'

// The v1 no-show card page. Standing replaced those cards (every one of them
// was cleared on 2026-09-15), so each old link — card emails, notifications,
// the RSVP button's "Why?" — lands on the member's standing instead.
export default function NoShowPage() {
  redirect('/standing')
}
