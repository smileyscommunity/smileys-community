import { APP_URL } from '@/lib/env'

export const metadata = {
  alternates: { canonical: `${APP_URL}/contact` },
  title: 'Contact — Smileys Community',
  description: 'Get in touch with the Smileys Community team. Questions about membership, events, advertising, or partnerships.',
  openGraph: {
    title: 'Contact Smileys Community',
    description: 'Reach out to the Smileys team — we\'re here to help.',
    url: `${APP_URL}/contact`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact Smileys Community',
    description: 'Reach out to the Smileys team — we\'re here to help.',
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
