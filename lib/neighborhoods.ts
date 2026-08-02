export function neighborhoodToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export function slugToNeighborhood(slug: string): string | undefined {
  return ISTANBUL_NEIGHBORHOODS.find(n => neighborhoodToSlug(n) === slug)
}

export type NeighborhoodSide = 'Central' | 'European' | 'Asian' | 'Coastal' | 'Emerging' | 'Islands'

export interface NeighborhoodMeta {
  emoji: string
  vibe:  string
  side:  NeighborhoodSide
  cost:  1 | 2 | 3
  lat:   number
  lon:   number
}

// Photography is added per-neighborhood over time, so this is deliberately a
// lookup rather than a required META field: a neighborhood without a photo
// renders its gradient/emoji treatment instead of a broken image slot, and
// dropping a file in public/images + one line here is the whole change.
// Filenames follow neighborhoodToSlug(name) — e.g. 'Kadıköy' -> kadikoy.
export const NEIGHBORHOOD_IMAGE: Record<string, string> = {
  'Kadıköy': '/app/images/neighborhood-kadikoy.jpg',
}

export function neighborhoodImage(name: string): string | null {
  return NEIGHBORHOOD_IMAGE[name] ?? null
}

export const NEIGHBORHOOD_META: Record<string, NeighborhoodMeta> = {
  // ── Central Social Hubs ──────────────────────────────────────────────────
  'Kadıköy':        { emoji: '🎨', vibe: 'Artsy & vibrant',                side: 'Central',  cost: 2, lat: 40.9906, lon: 29.0234 },
  'Moda':           { emoji: '☕', vibe: 'Laid-back & local',               side: 'Central',  cost: 2, lat: 40.9854, lon: 29.0270 },
  'Beşiktaş':       { emoji: '⚡', vibe: 'Lively & social',                 side: 'Central',  cost: 2, lat: 41.0438, lon: 29.0045 },
  'Beyoğlu':        { emoji: '🌃', vibe: 'Culture & nightlife',             side: 'Central',  cost: 2, lat: 41.0351, lon: 28.9773 },
  'Karaköy':        { emoji: '🖼️', vibe: 'Galleries & coffee',              side: 'Central',  cost: 2, lat: 41.0242, lon: 28.9742 },
  'Galata':         { emoji: '🏰', vibe: 'Historic & charming',             side: 'Central',  cost: 2, lat: 41.0261, lon: 28.9741 },
  'Cihangir':       { emoji: '🎭', vibe: 'Bohemian & creative',             side: 'Central',  cost: 2, lat: 41.0345, lon: 28.9817 },
  'Nişantaşı':      { emoji: '👜', vibe: 'Upscale & fashionable',           side: 'Central',  cost: 3, lat: 41.0510, lon: 28.9950 },
  'Teşvikiye':      { emoji: '🌹', vibe: 'Quiet luxury & boutiques',        side: 'Central',  cost: 3, lat: 41.0508, lon: 28.9986 },
  'Taksim':         { emoji: '🎶', vibe: 'Central & buzzing',               side: 'Central',  cost: 2, lat: 41.0369, lon: 28.9850 },
  'Ortaköy':        { emoji: '🕌', vibe: 'Iconic & scenic',                 side: 'Central',  cost: 2, lat: 41.0479, lon: 29.0280 },
  'Balat':          { emoji: '🌈', vibe: 'Colourful & artsy',               side: 'Central',  cost: 1, lat: 41.0265, lon: 28.9470 },

  // ── European Side ─────────────────────────────────────────────────────────
  'Şişli':          { emoji: '🏙️', vibe: 'Business & fashion',              side: 'European', cost: 2, lat: 41.0604, lon: 28.9873 },
  'Levent':         { emoji: '🏢', vibe: 'Corporate & modern',              side: 'European', cost: 3, lat: 41.0799, lon: 29.0103 },
  'Maslak':         { emoji: '🌆', vibe: 'Skyscrapers & business',          side: 'European', cost: 2, lat: 41.1090, lon: 29.0178 },
  'Etiler':         { emoji: '🌿', vibe: 'Leafy & affluent',                side: 'European', cost: 3, lat: 41.0777, lon: 29.0346 },
  'Bomonti':        { emoji: '🍺', vibe: 'Up-and-coming',                   side: 'European', cost: 2, lat: 41.0624, lon: 28.9803 },
  'Bebek':          { emoji: '🛥️', vibe: 'Bosphorus & affluent',            side: 'European', cost: 3, lat: 41.0775, lon: 29.0430 },
  'Arnavutköy':     { emoji: '🏡', vibe: 'Village charm on the Bosphorus',  side: 'European', cost: 3, lat: 41.0656, lon: 29.0500 },
  'Fener':          { emoji: '⛪', vibe: 'Historic & multicultural',         side: 'European', cost: 1, lat: 41.0310, lon: 28.9440 },
  'Eminönü':        { emoji: '⚓', vibe: 'Spice bazaar & port',             side: 'European', cost: 1, lat: 41.0177, lon: 28.9686 },
  'Sultanahmet':    { emoji: '🏛️', vibe: 'Historic heart',                  side: 'European', cost: 2, lat: 41.0055, lon: 28.9760 },
  'Fındıklı':       { emoji: '🌊', vibe: 'Waterfront arts',                 side: 'European', cost: 2, lat: 41.0282, lon: 28.9918 },
  'Kabataş':        { emoji: '🚢', vibe: 'Ferry hub & views',               side: 'European', cost: 2, lat: 41.0327, lon: 28.9991 },
  'Fulya':          { emoji: '🌿', vibe: 'Trendy & residential',            side: 'European', cost: 2, lat: 41.0574, lon: 29.0015 },
  'Gayrettepe':     { emoji: '💼', vibe: 'Business & metro hub',            side: 'European', cost: 2, lat: 41.0699, lon: 29.0053 },
  'Mecidiyeköy':    { emoji: '🚇', vibe: 'Bustling transit hub',            side: 'European', cost: 2, lat: 41.0673, lon: 29.0003 },
  'Ulus':           { emoji: '🌲', vibe: 'Affluent & leafy',                side: 'European', cost: 3, lat: 41.0729, lon: 29.0415 },
  'Pierre Loti':    { emoji: '☕', vibe: 'Hilltop views & tea gardens',     side: 'European', cost: 1, lat: 41.0500, lon: 28.9310 },
  'Fatih':          { emoji: '🕌', vibe: 'Traditional & historic',          side: 'European', cost: 1, lat: 41.0205, lon: 28.9415 },
  'Aksaray':        { emoji: '🌍', vibe: 'International & street food',      side: 'European', cost: 1, lat: 41.0143, lon: 28.9519 },
  'Eyüpsultan':     { emoji: '🌙', vibe: 'Spiritual & serene',              side: 'European', cost: 1, lat: 41.0472, lon: 28.9262 },
  'Bakırköy':       { emoji: '🛍️', vibe: 'Shopping & social',               side: 'European', cost: 2, lat: 40.9801, lon: 28.8730 },
  'Zeytinburnu':    { emoji: '🧵', vibe: 'Industrial & local',              side: 'European', cost: 1, lat: 41.0007, lon: 28.9018 },

  // ── Asian Side ────────────────────────────────────────────────────────────
  'Üsküdar':        { emoji: '🌅', vibe: 'Traditional & scenic',            side: 'Asian',    cost: 2, lat: 41.0264, lon: 29.0148 },
  'Kuzguncuk':      { emoji: '🌸', vibe: 'Village charm & cafés',           side: 'Asian',    cost: 2, lat: 41.0412, lon: 29.0382 },
  'Beylerbeyi':     { emoji: '🏰', vibe: 'Palace views & quiet',            side: 'Asian',    cost: 2, lat: 41.0396, lon: 29.0389 },
  'Çengelköy':      { emoji: '🌳', vibe: 'Quiet & scenic',                  side: 'Asian',    cost: 2, lat: 41.0482, lon: 29.0620 },
  'Acıbadem':       { emoji: '🏥', vibe: 'Calm & residential',              side: 'Asian',    cost: 2, lat: 41.0065, lon: 29.0379 },
  'Altunizade':     { emoji: '🌆', vibe: 'Modern & well-connected',         side: 'Asian',    cost: 2, lat: 41.0215, lon: 29.0498 },
  'Fenerbahçe':     { emoji: '⚽', vibe: 'Sporty & scenic',                 side: 'Asian',    cost: 2, lat: 40.9750, lon: 29.0399 },
  'Caddebostan':    { emoji: '🏖️', vibe: 'Beachside & social',              side: 'Asian',    cost: 2, lat: 40.9633, lon: 29.0620 },
  'Suadiye':        { emoji: '🌊', vibe: 'Breezy & relaxed',                side: 'Asian',    cost: 3, lat: 40.9578, lon: 29.0726 },
  'Erenköy':        { emoji: '🌳', vibe: 'Green & residential',             side: 'Asian',    cost: 2, lat: 40.9685, lon: 29.0610 },
  'Kozyatağı':      { emoji: '💼', vibe: 'Business & lifestyle',            side: 'Asian',    cost: 2, lat: 40.9871, lon: 29.0907 },
  'Göztepe':        { emoji: '🌺', vibe: 'Quiet & traditional',             side: 'Asian',    cost: 1, lat: 40.9760, lon: 29.0610 },
  'Bostancı':       { emoji: '🌳', vibe: 'Relaxed & local',                 side: 'Asian',    cost: 1, lat: 40.9622, lon: 29.0988 },
  'Feneryolu':      { emoji: '🏡', vibe: 'Quiet & residential',             side: 'Asian',    cost: 1, lat: 40.9694, lon: 29.0680 },
  'Ataşehir':       { emoji: '🏗️', vibe: 'Modern & growing',                side: 'Asian',    cost: 2, lat: 40.9897, lon: 29.1169 },

  // ── Coastal Areas ─────────────────────────────────────────────────────────
  'Beykoz':         { emoji: '🌲', vibe: 'Forests & Bosphorus villages',    side: 'Coastal',  cost: 2, lat: 41.1300, lon: 29.0940 },
  'Sarıyer':        { emoji: '⛵', vibe: 'Bosphorus villages',               side: 'Coastal',  cost: 2, lat: 41.1656, lon: 29.0560 },
  'Tarabya':        { emoji: '🎣', vibe: 'Serene & scenic',                  side: 'Coastal',  cost: 3, lat: 41.1356, lon: 29.0612 },
  'Yeniköy':        { emoji: '🌸', vibe: 'Charming & quiet',                 side: 'Coastal',  cost: 3, lat: 41.1183, lon: 29.0603 },
  'Zekeriyaköy':    { emoji: '🌲', vibe: 'Forest retreat',                   side: 'Coastal',  cost: 3, lat: 41.1824, lon: 29.0272 },
  'Ataköy':         { emoji: '🏖️', vibe: 'Beachside & modern',               side: 'Coastal',  cost: 2, lat: 40.9848, lon: 28.8683 },
  'Yeşilköy':       { emoji: '🌅', vibe: 'Seaside calm',                     side: 'Coastal',  cost: 2, lat: 40.9620, lon: 28.8275 },
  'Florya':         { emoji: '🌬️', vibe: 'Breezy coastal',                   side: 'Coastal',  cost: 2, lat: 40.9727, lon: 28.7969 },
  'Emirgan':        { emoji: '🌷', vibe: 'Tulip gardens & Bosphorus',       side: 'Coastal',  cost: 3, lat: 41.1107, lon: 29.0546 },
  'Rumeli Hisarı':  { emoji: '🏰', vibe: 'Fortress & Bosphorus views',      side: 'Coastal',  cost: 3, lat: 41.0874, lon: 29.0588 },
  'İstinye':        { emoji: '⛵', vibe: 'Marina & northern Bosphorus',      side: 'Coastal',  cost: 3, lat: 41.1028, lon: 29.0535 },

  // ── Islands ───────────────────────────────────────────────────────────────
  'Büyükada':       { emoji: '🚲', vibe: 'Car-free & grand',                 side: 'Islands',  cost: 2, lat: 40.8762, lon: 29.1262 },
  'Heybeliada':     { emoji: '🌲', vibe: 'Forested & serene',                side: 'Islands',  cost: 2, lat: 40.8793, lon: 29.0862 },
  'Burgazada':      { emoji: '⛵', vibe: 'Cosy island life',                  side: 'Islands',  cost: 2, lat: 40.8783, lon: 29.0573 },
  'Kınalıada':      { emoji: '🐑', vibe: 'Smallest & peaceful',              side: 'Islands',  cost: 1, lat: 40.9030, lon: 29.0374 },

  // ── Emerging Areas ────────────────────────────────────────────────────────
  'Kağıthane':      { emoji: '🏗️', vibe: 'Rising fast',                      side: 'Emerging', cost: 1, lat: 41.0783, lon: 28.9810 },
  'Güngören':       { emoji: '🏘️', vibe: 'Residential & local',              side: 'Emerging', cost: 1, lat: 41.0200, lon: 28.8750 },
  'Gaziosmanpaşa':  { emoji: '🌆', vibe: 'Dense & bustling',                 side: 'Emerging', cost: 1, lat: 41.0600, lon: 28.9133 },
  'Başakşehir':     { emoji: '🏙️', vibe: 'New Istanbul',                     side: 'Emerging', cost: 1, lat: 41.0906, lon: 28.8076 },
  'Beylikdüzü':     { emoji: '🌊', vibe: 'Western coast living',             side: 'Emerging', cost: 1, lat: 41.0074, lon: 28.6400 },
  'Büyükçekmece':   { emoji: '🌅', vibe: 'Coastal suburb',                   side: 'Emerging', cost: 1, lat: 41.0292, lon: 28.5785 },
  'Küçükçekmece':   { emoji: '🏘️', vibe: 'Lake & suburb',                    side: 'Emerging', cost: 1, lat: 41.0168, lon: 28.7740 },
  'Esenyurt':       { emoji: '🏗️', vibe: 'Fast-growing district',            side: 'Emerging', cost: 1, lat: 41.0301, lon: 28.6800 },
  'Bağcılar':       { emoji: '🚇', vibe: 'Metro-connected & busy',           side: 'Emerging', cost: 1, lat: 41.0370, lon: 28.8562 },
  'Ümraniye':       { emoji: '💡', vibe: 'Growing tech hub',                 side: 'Emerging', cost: 1, lat: 41.0185, lon: 29.1226 },
  'Maltepe':        { emoji: '🌊', vibe: 'Seaside & family',                 side: 'Emerging', cost: 1, lat: 40.9363, lon: 29.1303 },
  'Kartal':         { emoji: '🌊', vibe: 'Marmara shore & modern',           side: 'Emerging', cost: 1, lat: 40.9064, lon: 29.1887 },
  'Pendik':         { emoji: '🚝', vibe: 'Airport gateway & growing',        side: 'Emerging', cost: 1, lat: 40.8774, lon: 29.2345 },
  'Dragos':         { emoji: '🏔️', vibe: 'Dramatic sea views',               side: 'Emerging', cost: 1, lat: 40.9059, lon: 29.1750 },
  'Çekmeköy':       { emoji: '🌿', vibe: 'Forest & suburban',                side: 'Emerging', cost: 1, lat: 41.0353, lon: 29.1847 },
  'Yakacık':        { emoji: '🏘️', vibe: 'Quiet suburb',                    side: 'Emerging', cost: 1, lat: 40.9302, lon: 29.2045 },
  'Alibeyköy':      { emoji: '🏘️', vibe: 'Residential & local',             side: 'Emerging', cost: 1, lat: 41.0680, lon: 28.9380 },
  'Kemerburgaz':    { emoji: '🌲', vibe: 'Forest & retreat',                 side: 'Emerging', cost: 2, lat: 41.1540, lon: 28.8970 },
  'Göktürk':        { emoji: '🌳', vibe: 'Green suburb & villas',            side: 'Emerging', cost: 2, lat: 41.1420, lon: 28.8850 },
  'Bahçeşehir':     { emoji: '🏙️', vibe: 'Planned suburb & families',       side: 'Emerging', cost: 1, lat: 41.0641, lon: 28.6850 },
  'İçerenköy':      { emoji: '🏘️', vibe: 'Calm & residential',              side: 'Emerging', cost: 1, lat: 40.9855, lon: 29.0937 },
  'Kayışdağı':      { emoji: '🏘️', vibe: 'Residential & quiet',             side: 'Emerging', cost: 1, lat: 40.9890, lon: 29.1000 },
  'Cevizli':        { emoji: '🌊', vibe: 'Marmara coast suburb',             side: 'Emerging', cost: 1, lat: 40.9180, lon: 29.1550 },
  'İdealtepe':      { emoji: '🌊', vibe: 'Seaside residential',              side: 'Emerging', cost: 1, lat: 40.9440, lon: 29.1080 },
  'Aydos':          { emoji: '🌲', vibe: 'Forest & nature escape',           side: 'Emerging', cost: 1, lat: 40.9200, lon: 29.1800 },

  // ── Backfill: were in ISTANBUL_NEIGHBORHOODS (selectable as home) but had
  //    no META, so they never showed up in the directory / search ───────────
  'Avcılar':        { emoji: '🎓', vibe: 'Coastal west & campus life',       side: 'Emerging', cost: 1, lat: 40.9796, lon: 28.7214 },
  'Bahçelievler':   { emoji: '🏘️', vibe: 'Dense & residential',              side: 'Emerging', cost: 1, lat: 41.0022, lon: 28.8590 },
  'Bayrampaşa':     { emoji: '🏘️', vibe: 'Residential & local',             side: 'Emerging', cost: 1, lat: 41.0353, lon: 28.9127 },
  'Esenler':        { emoji: '🚌', vibe: 'Transit hub & local',              side: 'Emerging', cost: 1, lat: 41.0433, lon: 28.8817 },
  'Sultangazi':     { emoji: '🏗️', vibe: 'Fast-growing & residential',       side: 'Emerging', cost: 1, lat: 41.1058, lon: 28.8672 },
  'Silivri':        { emoji: '🌅', vibe: 'Far-west coastal escape',          side: 'Emerging', cost: 1, lat: 41.0736, lon: 28.2464 },
  'Çatalca':        { emoji: '🌾', vibe: 'Rural & green outskirts',          side: 'Emerging', cost: 1, lat: 41.1436, lon: 28.4614 },
  'Tuzla':          { emoji: '⚓', vibe: 'Marina & seaside east',            side: 'Emerging', cost: 1, lat: 40.8156, lon: 29.2997 },
  'Sancaktepe':     { emoji: '🏗️', vibe: 'Growing & residential',            side: 'Emerging', cost: 1, lat: 41.0006, lon: 29.2314 },
  'Sultanbeyli':    { emoji: '🏘️', vibe: 'Residential & local',             side: 'Emerging', cost: 1, lat: 40.9686, lon: 29.2678 },
  'Şile':           { emoji: '🏖️', vibe: 'Black Sea beaches & escape',        side: 'Coastal',  cost: 1, lat: 41.1758, lon: 29.6103 },
  'Galataport':     { emoji: '🛳️', vibe: 'Waterfront & cruise port',         side: 'Central',  cost: 3, lat: 41.0234, lon: 28.9805 },
  'Maçka':          { emoji: '🌳', vibe: 'Park & upscale calm',              side: 'Central',  cost: 3, lat: 41.0455, lon: 28.9938 },
  'Kurtuluş':       { emoji: '🌈', vibe: 'Historic & multicultural',         side: 'Central',  cost: 2, lat: 41.0553, lon: 28.9787 },
}

// The one and only neighborhood name list, derived from the META keys (author
// order) so it can never fall out of sync with the directory/search. Adding a
// neighborhood = adding a single NEIGHBORHOOD_META entry above. Re-exported by
// lib/data.ts as ISTANBUL_NEIGHBORHOODS for existing importers.
export const ISTANBUL_NEIGHBORHOODS: string[] = Object.keys(NEIGHBORHOOD_META)

export function getNeighborhoodMeta(name: string): NeighborhoodMeta {
  return NEIGHBORHOOD_META[name] ?? { emoji: '📍', vibe: 'Explore Istanbul', side: 'European', cost: 2, lat: 41.0082, lon: 28.9784 }
}
