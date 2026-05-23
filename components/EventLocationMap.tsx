'use client'

import dynamic from 'next/dynamic'

const MiniMap = dynamic(() => import('@/components/MiniMap'), { ssr: false })

interface Props {
  lat:   number
  lng:   number
  href?: string
}

export default function EventLocationMap({ lat, lng, href }: Props) {
  return <MiniMap lat={lat} lng={lng} href={href} />
}
