import { prisma } from '@/lib/prisma'

/**
 * Nationality → regional Culture club seeding.
 *
 * Members are auto-joined (approved ClubMembership) to the regional club(s)
 * matching their nationality. These clubs are public, so seeding fires NO
 * notifications — it just creates memberships + syncs memberCount. Idempotent
 * (skipDuplicates on the unique (userId, clubId)), so re-running only adds
 * members who joined since the last run. Members can leave anytime.
 *
 * nationality is stored as a country NAME (e.g. "Turkey"). A member may seed
 * into more than one club where it genuinely fits (Italy → Western European +
 * Mediterranean; Iran → Iranian + Middle Eastern).
 */

// country name → regional club slug(s). Turkey is added conditionally (see below).
export const COUNTRY_TO_CLUBS: Record<string, string[]> = {
  // Scandinavian
  'Sweden': ['scandinavian-culture'], 'Denmark': ['scandinavian-culture'],
  'Norway': ['scandinavian-culture'], 'Finland': ['scandinavian-culture'],
  'Iceland': ['scandinavian-culture'],
  // Balkan (Greece/Croatia also Mediterranean)
  'Greece': ['balkan-culture', 'mediterranean-culture'],
  'Serbia': ['balkan-culture'], 'Bulgaria': ['balkan-culture'],
  'Croatia': ['balkan-culture', 'mediterranean-culture'],
  'Bosnia': ['balkan-culture'], 'Bosnia and Herzegovina': ['balkan-culture'],
  'Albania': ['balkan-culture'], 'North Macedonia': ['balkan-culture'],
  'Macedonia': ['balkan-culture'], 'Montenegro': ['balkan-culture'],
  'Slovenia': ['balkan-culture'], 'Kosovo': ['balkan-culture'],
  // Eastern European
  'Poland': ['eastern-european-culture'], 'Ukraine': ['eastern-european-culture'],
  'Romania': ['eastern-european-culture'], 'Hungary': ['eastern-european-culture'],
  'Czechia': ['eastern-european-culture'], 'Czech Republic': ['eastern-european-culture'],
  'Slovakia': ['eastern-european-culture'], 'Belarus': ['eastern-european-culture'],
  'Moldova': ['eastern-european-culture'], 'Lithuania': ['eastern-european-culture'],
  'Latvia': ['eastern-european-culture'], 'Estonia': ['eastern-european-culture'],
  'Russia': ['eastern-european-culture'],
  // Western European (Italy/Spain/Malta also Mediterranean)
  'France': ['western-european-culture'],
  'Italy': ['western-european-culture', 'mediterranean-culture'],
  'Spain': ['western-european-culture', 'mediterranean-culture'],
  'Germany': ['western-european-culture'], 'United Kingdom': ['western-european-culture'],
  'Netherlands': ['western-european-culture'], 'Belgium': ['western-european-culture'],
  'Austria': ['western-european-culture'], 'Switzerland': ['western-european-culture'],
  'Portugal': ['western-european-culture'], 'Ireland': ['western-european-culture'],
  'Luxembourg': ['western-european-culture'],
  'Malta': ['western-european-culture', 'mediterranean-culture'],
  'Cyprus': ['mediterranean-culture'],
  // Latin American
  'Mexico': ['latin-american-culture'], 'Brazil': ['latin-american-culture'],
  'Colombia': ['latin-american-culture'], 'Argentina': ['latin-american-culture'],
  'Chile': ['latin-american-culture'], 'Peru': ['latin-american-culture'],
  'Venezuela': ['latin-american-culture'], 'Ecuador': ['latin-american-culture'],
  'Bolivia': ['latin-american-culture'], 'Cuba': ['latin-american-culture'],
  'Uruguay': ['latin-american-culture'], 'Paraguay': ['latin-american-culture'],
  'Guatemala': ['latin-american-culture'], 'Dominican Republic': ['latin-american-culture'],
  'Costa Rica': ['latin-american-culture'], 'Panama': ['latin-american-culture'],
  'Honduras': ['latin-american-culture'], 'El Salvador': ['latin-american-culture'],
  'Nicaragua': ['latin-american-culture'], 'Trinidad and Tobago': ['latin-american-culture'],
  // North American
  'United States': ['north-american-culture'], 'Canada': ['north-american-culture'],
  // Middle Eastern (Iran also gets its own club)
  'Syria': ['middle-eastern-culture'], 'Lebanon': ['middle-eastern-culture'],
  'Palestine': ['middle-eastern-culture'], 'Iraq': ['middle-eastern-culture'],
  'Jordan': ['middle-eastern-culture'], 'Saudi Arabia': ['middle-eastern-culture'],
  'Yemen': ['middle-eastern-culture'], 'Oman': ['middle-eastern-culture'],
  'United Arab Emirates': ['middle-eastern-culture'], 'Kuwait': ['middle-eastern-culture'],
  'Qatar': ['middle-eastern-culture'], 'Bahrain': ['middle-eastern-culture'],
  'Iran': ['iranian-culture', 'middle-eastern-culture'],
  // North African
  'Morocco': ['north-african-culture'], 'Tunisia': ['north-african-culture'],
  'Egypt': ['north-african-culture'], 'Algeria': ['north-african-culture'],
  'Libya': ['north-african-culture'], 'Sudan': ['north-african-culture'],
  // West African
  'Nigeria': ['west-african-culture'], 'Ghana': ['west-african-culture'],
  'Senegal': ['west-african-culture'], 'Ivory Coast': ['west-african-culture'],
  "Cote d'Ivoire": ['west-african-culture'], 'Gambia': ['west-african-culture'],
  'Mali': ['west-african-culture'], 'Cameroon': ['west-african-culture'],
  'Guinea': ['west-african-culture'], 'Sierra Leone': ['west-african-culture'],
  'Liberia': ['west-african-culture'], 'Togo': ['west-african-culture'],
  'Benin': ['west-african-culture'], 'Burkina Faso': ['west-african-culture'],
  // East African
  'Ethiopia': ['east-african-culture'], 'Kenya': ['east-african-culture'],
  'Tanzania': ['east-african-culture'], 'Somalia': ['east-african-culture'],
  'Uganda': ['east-african-culture'], 'Rwanda': ['east-african-culture'],
  'Burundi': ['east-african-culture'], 'Eritrea': ['east-african-culture'],
  'Djibouti': ['east-african-culture'], 'Seychelles': ['east-african-culture'],
  'Madagascar': ['east-african-culture'],
  // Southern African
  'South Africa': ['southern-african-culture'], 'Zimbabwe': ['southern-african-culture'],
  'Mozambique': ['southern-african-culture'], 'Botswana': ['southern-african-culture'],
  'Namibia': ['southern-african-culture'], 'Zambia': ['southern-african-culture'],
  'Malawi': ['southern-african-culture'], 'Angola': ['southern-african-culture'],
  'Lesotho': ['southern-african-culture'], 'Eswatini': ['southern-african-culture'],
  // East Asian
  'China': ['east-asian-culture'], 'Japan': ['east-asian-culture'],
  'South Korea': ['east-asian-culture'], 'North Korea': ['east-asian-culture'],
  'Taiwan': ['east-asian-culture'], 'Hong Kong': ['east-asian-culture'],
  // Southeast Asian
  'Thailand': ['southeast-asian-culture'], 'Vietnam': ['southeast-asian-culture'],
  'Indonesia': ['southeast-asian-culture'], 'Philippines': ['southeast-asian-culture'],
  'Malaysia': ['southeast-asian-culture'], 'Singapore': ['southeast-asian-culture'],
  'Myanmar': ['southeast-asian-culture'], 'Cambodia': ['southeast-asian-culture'],
  'Laos': ['southeast-asian-culture'], 'Brunei': ['southeast-asian-culture'],
  // Central Asian
  'Kazakhstan': ['central-asian-culture'], 'Uzbekistan': ['central-asian-culture'],
  'Kyrgyzstan': ['central-asian-culture'], 'Tajikistan': ['central-asian-culture'],
  'Turkmenistan': ['central-asian-culture'], 'Mongolia': ['central-asian-culture'],
  'Afghanistan': ['central-asian-culture'], 'Azerbaijan': ['central-asian-culture'],
  // Australian & Pacific
  'Australia': ['australian-pacific-culture'], 'New Zealand': ['australian-pacific-culture'],
  'Fiji': ['australian-pacific-culture'], 'Papua New Guinea': ['australian-pacific-culture'],
  'Samoa': ['australian-pacific-culture'], 'Tonga': ['australian-pacific-culture'],
}

export interface SeedResult {
  scanned: number
  desired: number
  netNew: number
  includeTurkey: boolean
  written: boolean
  perClub: { name: string; slug: string; added: number }[]
}

export async function seedRegionalClubs(opts: { includeTurkey?: boolean; dryRun?: boolean } = {}): Promise<SeedResult> {
  const includeTurkey = opts.includeTurkey ?? false
  const dryRun        = opts.dryRun ?? true

  // Effective map — never mutate the exported base.
  const map: Record<string, string[]> = includeTurkey
    ? { ...COUNTRY_TO_CLUBS, 'Turkey': ['mediterranean-culture'] }
    : COUNTRY_TO_CLUBS

  const targetSlugs = [...new Set(Object.values(map).flat())]
  const clubs = await prisma.club.findMany({
    where: { slug: { in: targetSlugs } },
    select: { id: true, slug: true, name: true },
  })
  const slugToId = new Map(clubs.map(c => [c.slug, c.id]))
  const missing = targetSlugs.filter(s => !slugToId.has(s))
  if (missing.length) throw new Error(`Missing regional clubs: ${missing.join(', ')}`)

  const users = await prisma.user.findMany({
    where: { status: 'approved' },
    select: { id: true, nationality: true },
  })

  const rows: { userId: string; clubId: string; status: string; role: string }[] = []
  for (const u of users) {
    const slugs = map[(u.nationality ?? '').trim()]
    if (!slugs) continue
    for (const slug of slugs) rows.push({ userId: u.id, clubId: slugToId.get(slug)!, status: 'approved', role: 'member' })
  }

  const existing = await prisma.clubMembership.findMany({
    where: { clubId: { in: clubs.map(c => c.id) } },
    select: { userId: true, clubId: true },
  })
  const existingKey = new Set(existing.map(m => `${m.userId}:${m.clubId}`))
  const fresh = rows.filter(r => !existingKey.has(`${r.userId}:${r.clubId}`))

  const addedByClub = new Map<string, number>()
  for (const r of fresh) addedByClub.set(r.clubId, (addedByClub.get(r.clubId) ?? 0) + 1)
  const perClub = clubs
    .map(c => ({ name: c.name, slug: c.slug, added: addedByClub.get(c.id) ?? 0 }))
    .sort((a, b) => b.added - a.added)

  if (!dryRun && fresh.length > 0) {
    const CHUNK = 500
    for (let i = 0; i < fresh.length; i += CHUNK) {
      await prisma.clubMembership.createMany({ data: fresh.slice(i, i + CHUNK), skipDuplicates: true })
    }
    // Sync memberCount to the true approved count on every touched club.
    for (const c of clubs) {
      const count = await prisma.clubMembership.count({ where: { clubId: c.id, status: 'approved' } })
      await prisma.club.update({ where: { id: c.id }, data: { memberCount: count } })
    }
  }

  return { scanned: users.length, desired: rows.length, netNew: fresh.length, includeTurkey, written: !dryRun && fresh.length > 0, perClub }
}
