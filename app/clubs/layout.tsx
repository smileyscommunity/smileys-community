import { APP_URL } from '@/lib/env'

export const metadata = {
  alternates: { canonical: `${APP_URL}/clubs` },
  title: 'Clubs in Istanbul — Smileys Community',
  description: 'Join interest-based clubs in Istanbul — hiking, photography, French conversation, sailing, book clubs and more. Find your people at Smileys.',
  openGraph: {
    title: 'Istanbul Social Clubs — Smileys Community',
    description: 'Over 70 interest-based clubs in Istanbul. Find your community at Smileys.',
    url: `${APP_URL}/clubs`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul Social Clubs — Smileys Community',
    description: 'Over 70 interest-based clubs in Istanbul. Find your community at Smileys.',
  },
}

export default function ClubsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
