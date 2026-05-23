export type UserRole = 'admin' | 'moderator' | 'member' | 'partner'

export interface AppUser {
  id: string
  name: string
  initials: string
  color: string
  role: UserRole
  isClubHost?: boolean
  joinedEvents?: string[]
  joinedAt?: string
  email?: string
  bio?: string
  neighborhood?: string
  instagram?: string
  emailVerified?: boolean
  phone?: string
  nationality?: string
  languages?: string[]
  interests?: string[]
  status?: string
  membershipType?: string
  profilePhoto?: string
  partnerId?: string | null
}

