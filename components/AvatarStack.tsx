'use client'

import { resolveImageUrl, getInitials } from '@/lib/data'

interface Person {
  id: string
  name: string
  color: string
  profilePhoto?: string | null
}

interface AvatarStackProps {
  people: Person[]
  total?: number
  max?: number
  size?: 'sm' | 'md'
}

export default function AvatarStack({ people, total, max = 5, size = 'md' }: AvatarStackProps) {
  const shown   = people.slice(0, max)
  const sizeCls = size === 'sm' ? 'w-7 h-7 text-[9px]' : 'w-9 h-9 text-xs'
  const extra   = (total ?? people.length) - shown.length

  return (
    <div className="flex items-center -space-x-2">
      {shown.map(p => {
        const photo = resolveImageUrl(p.profilePhoto)
        return (
          <span key={p.id} className="relative shrink-0">
            {photo ? (
              <img
                src={photo}
                alt={p.name}
                title={p.name}
                className={`${sizeCls} rounded-full object-cover border-2 border-white shadow-sm`}
                onError={e => {
                  e.currentTarget.style.display = 'none'
                  const fb = e.currentTarget.nextElementSibling as HTMLElement | null
                  if (fb) fb.style.display = 'flex'
                }}
              />
            ) : null}
            <span
              title={p.name}
              className={`${sizeCls} rounded-full items-center justify-center text-white font-bold border-2 border-white shadow-sm`}
              style={{ backgroundColor: p.color, display: photo ? 'none' : 'flex' }}
            >
              {getInitials(p.name)}
            </span>
          </span>
        )
      })}
      {extra > 0 && (
        <div className={`${sizeCls} rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 border-2 border-white shadow-sm shrink-0`}>
          +{extra}
        </div>
      )}
    </div>
  )
}
