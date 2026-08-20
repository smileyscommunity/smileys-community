import type { ReactNode } from 'react'

// Metadata deliberately does NOT live here. A layout receives no searchParams,
// so it could only ever resolve the city from the cookie — and the crawler
// that fetches a shared link has no cookie, which is why every city's guide
// shared as the default city's. app/guide/page.tsx owns it now and reads
// ?city=, the same way /neighborhoods does.
export default function GuideLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
