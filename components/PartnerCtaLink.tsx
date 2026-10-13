'use client'

import Link from 'next/link'
import { track } from '@/lib/analytics'
import type { ReactNode } from 'react'

export default function PartnerCtaLink({ href, cta, className, children }: { href: string; cta: string; className?: string; children: ReactNode }) {
  return <Link href={href} className={className} onClick={() => track('partner_cta_click', { cta })}>{children}</Link>
}
