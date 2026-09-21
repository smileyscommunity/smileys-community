// URL-safe slug from a human-readable name. Standard pattern:
// lowercase, non-alphanumerics → hyphens, collapse runs, trim ends.
// Used by admin create flows (clubs, posts, campaigns) so trailing
// whitespace ("Women ") or punctuation ("Comedy!") don't produce
// "women-" / "comedy-" with a dangling hyphen.
//
// Letters outside a–z used to be dropped rather than transliterated, so
// "Kadıköy" became "kad-k-y", "Yeldeğirmeni" "yelde-irmeni", "İzmir" "i-zmir",
// and a title in Georgian or Cyrillic — the first non-Turkish city is Tbilisi —
// had no letters left at all and fell to the caller's fallback ("story",
// "story-1"). Existing slugs are permanent (indexed URLs); this changes only
// what a new title gets.
const TURKISH: Record<string, string> = {
  'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g',
  'ç': 'c', 'Ç': 'c', 'ö': 'o', 'Ö': 'o', 'ü': 'u', 'Ü': 'u', 'ß': 'ss', 'æ': 'ae', 'ø': 'o',
}

// Georgian (Mkhedruli) and Cyrillic to the Latin letters their romanisation
// uses. Not a linguistic standard — a readable, stable URL is the whole job.
const GEORGIAN = 'ა:a ბ:b გ:g დ:d ე:e ვ:v ზ:z თ:t ი:i კ:k ლ:l მ:m ნ:n ო:o პ:p ჟ:zh რ:r ს:s ტ:t უ:u ფ:p ქ:k ღ:gh ყ:q შ:sh ჩ:ch ც:ts ძ:dz წ:ts ჭ:ch ხ:kh ჯ:j ჰ:h'
const CYRILLIC = 'а:a б:b в:v г:g д:d е:e ё:yo ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:kh ц:ts ч:ch ш:sh щ:shch ъ: ы:y ь: э:e ю:yu я:ya'

const MAP: Record<string, string> = { ...TURKISH }
for (const pair of `${GEORGIAN} ${CYRILLIC}`.split(' ')) {
  const [from, to] = pair.split(':')
  MAP[from] = to ?? ''
  MAP[from.toUpperCase()] = to ?? ''
}

export function slugify(name: string): string {
  return Array.from(name)
    .map(ch => MAP[ch] ?? ch)
    .join('')
    // Anything still accented (é, ñ, ą) loses its mark rather than the letter.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// A slug cut to fit a column or a URL ends on a whole word, not "…-somew".
export function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) return slug
  const cut = slug.slice(0, max)
  const at  = cut.lastIndexOf('-')
  return (at > 0 ? cut.slice(0, at) : cut).replace(/-+$/, '')
}
