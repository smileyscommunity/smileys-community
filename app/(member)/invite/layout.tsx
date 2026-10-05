import type { Metadata } from 'next'

// The page is a client component, so its title lives here. Without it the
// tab read the site's default title. Members-only, so never indexed.
export const metadata: Metadata = {
  title:  'Invite friends — Smileys Community',
  robots: { index: false, follow: false },
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
