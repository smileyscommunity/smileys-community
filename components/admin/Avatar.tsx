import { getInitials } from '@/lib/data'

type Size = 'sm' | 'md'

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'w-7 h-7',
  md: 'w-8 h-8',
}

export default function Avatar({ name, color, size = 'md' }: {
  name: string
  color: string
  size?: Size
}) {
  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`}
      style={{ backgroundColor: color }}
    >
      {getInitials(name)}
    </div>
  )
}
