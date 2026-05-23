import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In — Smileys Community',
  description: 'Sign in to your Smileys Community account to access events, clubs, and your member profile.',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
