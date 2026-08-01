import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { areApplicationsOpen } from '@/lib/communitySettings'

// Reads the intake switch per request so pausing/reopening applications from
// /admin/settings takes effect immediately (no deploy).
export const dynamic = 'force-dynamic'

// A page-level `openGraph` block loses the root layout's default og:image
// (Next.js doesn't deep-merge nested metadata) — see app/about/page.tsx for
// the full explanation. Without this, the page shared with no preview at
// all on WhatsApp/iMessage/Twitter.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Apply to Join Smileys',
  eyebrow: "Istanbul's curated social community",
  cta:     '5-minute application',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/apply` },
  title: 'Apply to Join Smileys — Istanbul\'s Curated Social Community',
  description: 'Apply to become a member of Smileys Community in Istanbul. Meet expats and locals through curated events, clubs, and genuine social experiences.',
  openGraph: {
    title: 'Apply to Join Smileys Community',
    description: 'Join Istanbul\'s most vibrant curated social community. Application takes 5 minutes.',
    url: `${APP_URL}/apply`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Apply to Join Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Apply to Join Smileys Community',
    description: 'Join Istanbul\'s most vibrant curated social community. Application takes 5 minutes.',
    images: [ogImage],
  },
}

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  if (!areApplicationsOpen()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm px-4">
        <div className="max-w-md text-center bg-white rounded-2xl shadow-card p-8">
          <div className="text-4xl mb-4">🌿</div>
          <h1 className="text-xl font-extrabold text-gray-900 mb-2">Applications are closed right now</h1>
          <p className="text-sm text-gray-600 mb-6">
            We&apos;ve paused new member applications while we focus on our current community. Follow us on Instagram to hear when we reopen.
          </p>
          <Link href="/" className="inline-block px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
