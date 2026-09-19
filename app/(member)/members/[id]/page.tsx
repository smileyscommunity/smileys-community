import type { Metadata } from 'next'
import MemberProfileClient from './MemberProfileClient'

// Member profiles are members-only, but the page HTML (including the <head>)
// is rendered before the client's API fetch applies any gate. The head used
// to carry the member's full name, bio, neighbourhood and photo to any
// logged-in viewer — including one they'd blocked, or who can only see a
// connections-only member's first name. Nothing personal goes in it; the
// profile's content comes from /api/members/[id], which applies the rules.
// Link previews never had a session, so shared links look the same as before.
export const metadata: Metadata = {
  title: 'Member profile — Smileys Community',
  robots: { index: false, follow: false },
}

export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <MemberProfileClient params={params} />
}
