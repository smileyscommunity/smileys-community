'use client'

import dynamic from 'next/dynamic'

const NeighborhoodMap = dynamic(() => import('./NeighborhoodMap'), { ssr: false })

interface Props {
  lat: number
  lon: number
  name: string
}

export default function MapSection({ lat, lon, name }: Props) {
  return <NeighborhoodMap lat={lat} lon={lon} name={name} />
}
