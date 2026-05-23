import { resolveImageUrl, getInitials } from '@/lib/data'

interface AvatarUser {
  name: string
  color: string
  profilePhoto?: string | null
}

const sizes = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-16 h-16 text-base',
}

interface Props {
  user: AvatarUser
  size?: keyof typeof sizes
  className?: string
}

export default function UserAvatar({ user, size = 'md', className = '' }: Props) {
  const photo = resolveImageUrl(user.profilePhoto)
  const cls = `${sizes[size]} rounded-full shrink-0 ${className}`
  return photo ? (
    <img src={photo} alt={user.name} className={`${cls} object-cover`} />
  ) : (
    <div className={`${cls} flex items-center justify-center text-white font-bold`}
      style={{ backgroundColor: user.color }}>
      {getInitials(user.name)}
    </div>
  )
}
