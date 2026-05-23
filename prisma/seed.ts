import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma   = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])

async function main() {
  console.log('Seeding clubs...')

  const clubs = [
    { id: '1', name: 'Smileys Sailing Club', slug: 'smileys-sailing-club', description: 'Set sail on the Bosphorus with fellow adventurers. From golden-hour cruises to competitive regattas, we explore Istanbul from the water with good vibes and great people.', category: 'Adventure', emoji: '⛵', color: 'text-blue-600', bgColor: 'bg-blue-50', memberCount: 124 },
    { id: '2', name: 'SpeakEasy',            slug: 'speakeasy',            description: 'Language exchange nights across Kadıköy and beyond. Practice Turkish, English, Spanish, French, and more in a relaxed, social setting designed for real conversation.',         category: 'Language',  emoji: '💬', color: 'text-purple-600', bgColor: 'bg-purple-50', memberCount: 287 },
    { id: '3', name: 'Eat Up Istanbul',       slug: 'eat-up-istanbul',      description: "From Bomonti meyhanes to Karaköy hidden kitchens — curated dining experiences designed to connect you with Istanbul's food scene and the people who love it.",                 category: 'Food & Dining', emoji: '🍽️', color: 'text-orange-600', bgColor: 'bg-orange-50', memberCount: 342 },
    { id: '4', name: 'Flow by Smileys',       slug: 'flow-by-smileys',      description: 'Outdoor yoga, breathwork, and mindful movement in Maçka Parkı and across the city. Wellness for the social soul — designed to restore your energy and deepen human connection.', category: 'Wellness',  emoji: '🧘', color: 'text-green-600', bgColor: 'bg-green-50', memberCount: 198 },
    { id: '5', name: 'Hiking Club',           slug: 'hiking-club',          description: "Discover Istanbul's hidden trails, ancient forests, and stunning coastal paths. Weekly hikes for all levels — from leisurely walks to full-day challenging treks.",              category: 'Outdoors', emoji: '🥾', color: 'text-amber-600', bgColor: 'bg-amber-50', memberCount: 156 },
  ]

  for (const club of clubs) {
    await prisma.club.upsert({ where: { id: club.id }, update: club, create: club })
  }
  console.log(`✓ ${clubs.length} clubs seeded`)

  console.log('Seeding events...')

  const events = [
    {
      id: '1', title: 'Sunset Sailing on the Bosphorus', date: '2026-04-26', time: '17:30',
      location: 'Tarabya Marina', neighborhood: 'Tarabya', hostId: 'captain_efe', clubId: '1',
      description: 'Watch the sun dip below the horizon from the deck of a sailboat on the Bosphorus. Wine, light snacks, curated music, and incredible company included. No sailing experience required.',
      limitedSpots: true, spotsLeft: 0, totalSpots: 12, price: 350, memberPrice: 250,
      vibes: ['Social', 'Chill'],
      emoji: '⛵', isPremium: true, membersOnly: false,
      whatsappUrl: 'https://chat.whatsapp.com/SunsetSailingSmileys',
    },
    {
      id: '2', title: 'Dinner with Strangers', date: '2026-04-29', time: '19:00',
      location: 'Üç Kuruş Bomonti', neighborhood: 'Bomonti', hostId: 'elif', clubId: '3',
      description: 'Eight strangers. One beautifully set table. Endless stories. Our signature dining experience thoughtfully pairs you with fascinating people from all walks of life.',
      limitedSpots: true, spotsLeft: 0, totalSpots: 8, price: 250, memberPrice: 200,
      vibes: ['Social', 'Networking'],
      emoji: '🍽️', isPremium: true, membersOnly: true,
    },
    {
      id: '3', title: 'Language Exchange Night', date: '2026-05-02', time: '19:30',
      location: 'Moda Sahnesi', neighborhood: 'Kadıköy', hostId: 'speakeasy_team', clubId: '2',
      description: 'Rotate between tables of native speakers every 15 minutes. Practice your Turkish, English, Spanish, or French in casual, structured conversations.',
      limitedSpots: false, spotsLeft: 18, totalSpots: 40, price: 0,
      vibes: ['Social', 'Networking', 'Chill'],
      emoji: '💬', isPremium: false, membersOnly: false,
    },
    {
      id: '4', title: 'Rooftop DJ Social Night', date: '2026-05-09', time: '21:00',
      location: 'Taksim Meydanı Rooftop', neighborhood: 'Taksim', hostId: 'smileys_hq', clubId: '1',
      description: "Istanbul's most vibrant rooftop. Live DJ sets spanning deep house to indie, craft cocktails, and the full Bosphorus skyline as your backdrop.",
      limitedSpots: true, spotsLeft: 15, totalSpots: 60, price: 150, memberPrice: 100,
      vibes: ['Party', 'Social'],
      emoji: '🎵', isPremium: true, membersOnly: false,
    },
    {
      id: '5', title: 'Sunday Morning Flow', date: '2026-05-17', time: '09:30',
      location: 'Maçka Parkı', neighborhood: 'Maçka', hostId: 'flow_team', clubId: '4',
      description: 'Start your Sunday with an outdoor yoga flow and breathwork session in the green heart of the city. Bring a mat, we\'ll bring the good energy.',
      limitedSpots: false, spotsLeft: 12, totalSpots: 20, price: 180,
      vibes: ['Chill', 'Active'],
      emoji: '🌿', isPremium: false, membersOnly: false,
    },
  ]

  for (const event of events) {
    await prisma.event.upsert({ where: { id: event.id }, update: event, create: event })
  }
  console.log(`✓ ${events.length} events seeded`)

  console.log('Done!')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
