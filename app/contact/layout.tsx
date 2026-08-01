import { APP_URL } from '@/lib/env'

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Contact Us',
  eyebrow: 'Smileys Community',
  cta:     'Get in touch',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/contact` },
  title: 'Contact — Smileys Community',
  description: 'Get in touch with the Smileys Community team. Questions about membership, events, advertising, or partnerships.',
  openGraph: {
    title: 'Contact Smileys Community',
    description: 'Reach out to the Smileys team — we\'re here to help.',
    url: `${APP_URL}/contact`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Contact Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact Smileys Community',
    description: 'Reach out to the Smileys team — we\'re here to help.',
    images: [ogImage],
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
