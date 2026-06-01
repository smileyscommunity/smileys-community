export const ISTANBUL_NEIGHBORHOODS = [
  // Central social hubs
  'Kadıköy', 'Moda', 'Beşiktaş', 'Beyoğlu',
  'Karaköy', 'Galata', 'Cihangir', 'Nişantaşı', 'Teşvikiye', 'Taksim', 'Ortaköy', 'Balat',
  // European side
  'Şişli', 'Levent', 'Maslak', 'Etiler', 'Bomonti', 'Bebek',
  'Arnavutköy', 'Fener', 'Eminönü', 'Sultanahmet', 'Fındıklı',
  'Kabataş', 'Fulya', 'Gayrettepe', 'Mecidiyeköy', 'Ulus',
  'Pierre Loti', 'Fatih', 'Eyüpsultan', 'Bakırköy', 'Zeytinburnu',
  // Asian side
  'Üsküdar', 'Kuzguncuk', 'Beylerbeyi', 'Çengelköy', 'Acıbadem',
  'Altunizade', 'Fenerbahçe', 'Feneryolu', 'Caddebostan',
  'Suadiye', 'Erenköy', 'Kozyatağı', 'Göztepe', 'Bostancı',
  // Coastal
  'Sarıyer', 'Tarabya', 'Yeniköy', 'Zekeriyaköy', 'Emirgan',
  'Rumeli Hisarı', 'İstinye', 'Ataköy', 'Yeşilköy', 'Florya',
  // Islands
  'Büyükada', 'Heybeliada', 'Burgazada', 'Kınalıada',
  // Emerging / residential — European
  'Kağıthane', 'Alibeyköy', 'Kemerburgaz', 'Göktürk', 'Bahçeşehir',
  'Güngören', 'Gaziosmanpaşa', 'Başakşehir', 'Beylikdüzü',
  'Büyükçekmece', 'Küçükçekmece', 'Esenyurt', 'Bağcılar', 'Bahçelievler',
  // Emerging / residential — Asian
  'Ümraniye', 'Maltepe', 'Kartal', 'Pendik', 'Tuzla', 'Dragos',
  'Çekmeköy', 'Sancaktepe', 'Yakacık', 'Ataşehir',
  'İçerenköy', 'Kayışdağı', 'Cevizli', 'İdealtepe', 'Aydos',
  // Legacy / less common (kept for backward-compat)
  'Avcılar', 'Beykoz', 'Bayrampaşa', 'Çatalca', 'Esenler', 'Galataport',
  'Kurtuluş', 'Maçka', 'Silivri', 'Sultanbeyli',
  'Sultangazi', 'Şile',
] as const

export const CLUB_CATEGORIES = [
  'Outdoor', 'Social', 'Food & Drinks', 'Nightlife', 'Networking', 'Business',
  'Learning', 'Creative', 'Wellness', 'Sports',
  'Travel', 'Culture', 'Exclusive', 'Volunteering',
] as const

export type ClubCategory = typeof CLUB_CATEGORIES[number]

// Tiny amber-100 SVG — used as blur placeholder for all dynamic images
export const BLUR_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSI2Ij48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmVmM2M3Ii8+PC9zdmc+'

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('/uploads/'))   return `/app/api/files/${url.replace('/uploads/', '')}`
  if (url.startsWith('/api/files/')) return `/app${url}`
  return url
}

// Sized variant for avatars / small icons. The file route (see
// app/api/files/[...path]/route.ts) accepts `?w=64|128|256` and
// returns a sharp-resized JPEG. Original 1200×1200 uploads are
// ~150–300 KB; the 64-wide thumb is ~2–4 KB. Falls through to the
// original URL when the source is external (Unsplash, etc.) —
// those already use their own optimization.
const SIZED_PATH = /^\/app\/api\/files\//
export function avatarUrl(url: string | null | undefined, size: 64 | 128 | 256 = 64): string {
  const resolved = resolveImageUrl(url)
  if (!resolved || !SIZED_PATH.test(resolved)) return resolved
  return `${resolved}?w=${size}`
}

export interface Club {
  id: string
  slug: string
  name: string
  description: string
  category: string
  memberCount: number
  emoji: string
  color: string
  bgColor: string
  isPrivate?: boolean
  coverImage?: string | null
  coverImagePosition?: number
  whatsappUrl?: string | null
  instagramUrl?: string | null
  nextEvent?: { title: string; date: string } | null
}

export interface Event {
  id: string
  title: string
  date: string
  time: string
  location: string
  neighborhood: string
  hostId: string
  hostName: string
  hostColor?: string
  hostPhoto?: string | null
  clubId: string
  clubName: string
  description: string
  limitedSpots: boolean
  spotsLeft: number
  totalSpots: number
  price: number
  tags: string[]
  vibes: VibeTag[]
  emoji: string
  isPremium: boolean
  membersOnly: boolean
  memberPrice?: number
  whatsappUrl?: string
  currency?: string
  approvalRequired?: boolean
  genderBalance?: boolean
  maleQuota?: number | null
  turkishMaleQuota?: number | null
  status?: string
  address?: string
  coverImage?: string
  coverImagePosition?: number
  meetingUrl?: string
  lat?: number | null
  lng?: number | null
  duration?: number | null
  minAge?: number | null
  maxAge?: number | null
  language?: string | null
  difficulty?: string | null
  refundPolicy?: string | null
  registrationDeadline?: string | null
  endTime?: string | null
  cancelReason?: string | null
  isRecurring?: boolean
  seriesId?: string | null
  featured?: boolean
  attendeePreviews?: { id: string; name: string; color: string; profilePhoto?: string | null }[]
}

export type VibeGroup = 'Energy' | 'Purpose' | 'Experience'

export type VibeTag =
  | 'Chill' | 'Active' | 'Party' | 'Intimate'
  | 'Social' | 'Networking' | 'Learning' | 'Creative'
  | 'Food' | 'Cultural' | 'Outdoor' | 'Wellness' | 'Adventure'

export const vibeGroups: Record<VibeGroup, { emoji: string; description: string; tags: VibeTag[] }> = {
  Energy: {
    emoji: '⚡',
    description: 'The energy level of the event',
    tags: ['Chill', 'Active', 'Party', 'Intimate'],
  },
  Purpose: {
    emoji: '🎯',
    description: 'Why people come',
    tags: ['Social', 'Networking', 'Learning', 'Creative'],
  },
  Experience: {
    emoji: '✨',
    description: 'What the event is about',
    tags: ['Food', 'Cultural', 'Outdoor', 'Wellness', 'Adventure'],
  },
}

export const vibeConfig: Record<VibeTag, { emoji: string; bg: string; text: string; border: string; description: string }> = {
  Chill:      { emoji: '😌', bg: 'bg-teal-100',    text: 'text-teal-700',    border: 'border-teal-400',    description: 'Low-key, relaxed atmosphere' },
  Active:     { emoji: '🏃', bg: 'bg-green-100',   text: 'text-green-700',   border: 'border-green-400',   description: 'Move your body, outdoor adventures' },
  Party:      { emoji: '🎊', bg: 'bg-pink-100',    text: 'text-pink-700',    border: 'border-pink-400',    description: 'High energy, music, dancing' },
  Intimate:   { emoji: '🕯️', bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-300',     description: 'Small group, deep connections' },
  Social:     { emoji: '🙌', bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-blue-400',    description: 'Meet new people, great conversations' },
  Networking: { emoji: '🤝', bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-400',  description: 'Career connections, meaningful encounters' },
  Learning:   { emoji: '📚', bg: 'bg-sky-100',     text: 'text-sky-700',     border: 'border-sky-400',     description: 'Grow your mind, share knowledge' },
  Creative:   { emoji: '🎨', bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-400', description: 'Make, build, and express yourself' },
  Food:       { emoji: '🍽️', bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-orange-400',  description: 'Good food, great company' },
  Cultural:   { emoji: '🎭', bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-rose-400',    description: 'Art, heritage, and local culture' },
  Outdoor:    { emoji: '🌿', bg: 'bg-lime-100',    text: 'text-lime-700',    border: 'border-lime-400',    description: 'Fresh air, nature, open spaces' },
  Wellness:   { emoji: '🧘', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-400', description: 'Mind, body, and soul balance' },
  Adventure:  { emoji: '🧗', bg: 'bg-stone-100',   text: 'text-stone-700',   border: 'border-stone-400',   description: 'Thrilling, bold, out of comfort zone' },
}

export interface Review {
  id: string
  userId: string
  userName: string
  userInitials: string
  userColor: string
  userPhoto?: string | null
  rating: number
  text: string
  createdAt: string
}

export function todayIstanbul(offsetDays = 0): string {
  const d = new Date()
  if (offsetDays) d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatTime(timeStr: string): string {
  const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let h = parseInt(match12[1])
    const m = match12[2]
    const period = match12[3].toUpperCase()
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${m}`
  }
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})/)
  if (match24) return `${match24[1].padStart(2, '0')}:${match24[2]}`
  return timeStr
}

export function getInitials(name: string): string {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}
