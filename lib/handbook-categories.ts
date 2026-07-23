// Handbook category metadata, shared by the category listing page and the
// individual article pages so both render the same hero image + copy.
//
// `image` is the category hero banner (generated, one per category — a colored
// gradient with the label/tagline). Static assets live in public/images and are
// served under the /app basePath, so the src is the full '/app/images/…' path.
// alt is stored alongside so the banner stays accessible.
export type CategoryMeta = {
  emoji:   string
  label:   string
  tagline: string
  image:   { src: string; alt: string }
}

export const HANDBOOK_CATEGORIES: Record<string, CategoryMeta> = {
  'Bureaucracy': {
    emoji: '📋', label: 'Bureaucracy & Legal', tagline: 'Permits, taxes, paperwork — the slow grind of being legal.',
    image: { src: '/app/images/handbook-bureaucracy.jpeg', alt: 'Bureaucracy & Legal — Istanbul Handbook' },
  },
  'Money': {
    emoji: '💳', label: 'Money', tagline: 'Banking, FX, inflation, paying for the everyday.',
    image: { src: '/app/images/handbook-money.jpeg', alt: 'Money — Istanbul Handbook' },
  },
  'Daily Life': {
    emoji: '🏠', label: 'Daily Life', tagline: 'Apartments, doctors, utilities, the small things that wear you down until they don\'t.',
    image: { src: '/app/images/handbook-daily-life.jpeg', alt: 'Daily Life — Istanbul Handbook' },
  },
  'Family': {
    emoji: '👨‍👩‍👧', label: 'Family', tagline: 'Schools, kreş, kids\' healthcare — raising a family while you\'re still figuring it out yourself.',
    image: { src: '/app/images/handbook-family.jpeg', alt: 'Family — Istanbul Handbook' },
  },
  'Getting Around': {
    emoji: '🚇', label: 'Getting Around', tagline: 'Transport, driving, flights — the city is big, the answers are simple.',
    image: { src: '/app/images/handbook-getting-around.jpeg', alt: 'Getting Around — Istanbul Handbook' },
  },
}

// The category hero banner for a given article category, or null if the
// category is unknown (defensive — keeps callers from rendering a broken img).
export function categoryHero(category: string): { src: string; alt: string } | null {
  return HANDBOOK_CATEGORIES[category]?.image ?? null
}
