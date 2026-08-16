// Single source of truth for City Guide ↔ Handbook cross-linking.
// City Guide categories live in data/city-guide.json; Handbook
// categories are a fixed list in the app code. Both surfaces import
// from here so a rename only happens in one place.

// Handbook category (Post.category for kind='handbook') →
// quick-reference anchor, plus a short callout label. The quick-links
// block moved from /guide to /handbook in the IA cleanup, so these
// anchors now resolve on /handbook itself. The anchor matches the
// slugified label TransitLinks generates (see
// components/TransitLinks.tsx#categoryId).
// Keys are CANONICAL handbook categories (see lib/handbook-categories) — call
// canonicalCategory() on a stored value before looking up here. Categories
// with no matching quick-reference section are deliberately absent rather than
// pointed at a loosely-related anchor: the previous table sent 'Family' to the
// Healthcare links, which is not where a reader asking about schools expects
// to land. A missing entry renders no callout, which is the honest outcome.
export const HANDBOOK_TO_GUIDE: Record<string, { anchor: string; label: string }> = {
  'Residence & Legal':  { anchor: 'visa-residence',   label: 'Visa & Residence apps and links' },
  'Money & Banking':    { anchor: 'banking-money',    label: 'Banking & Money apps and links' },
  'Home & Housing':     { anchor: 'housing',          label: 'Housing, utilities, and daily essentials' },
  'Healthcare':         { anchor: 'healthcare',       label: 'Healthcare quick links' },
  'Getting Around':     { anchor: 'getting-around',   label: 'Getting Around apps and links' },
  'Mobile & Digital':   { anchor: 'mobile-internet',  label: 'Mobile & Internet apps and links' },
  'Getting Started':    { anchor: 'essential-apps',   label: 'The apps to install first' },
  'Everyday Life':      { anchor: 'practical-info',   label: 'Practical everyday links' },
}

// City Guide section label → Handbook category. Inverse mapping used
// when rendering "Read the deep dive →" on /guide sections that have
// a matching long-form article category.
// NOTE: currently has no consumers — the "Read the deep dive →" affordance it
// was written for was never wired up. Kept (and kept correct) as the declared
// inverse of HANDBOOK_TO_GUIDE so the two can't silently disagree if it is.
export const GUIDE_TO_HANDBOOK: Record<string, string> = {
  'Visa & Residence':   'Residence & Legal',
  'Banking & Money':    'Money & Banking',
  'Housing':            'Home & Housing',
  'Healthcare':         'Healthcare',
  'Mobile & Internet':  'Mobile & Digital',
  'Getting Around':     'Getting Around',
  'Essential Apps':     'Getting Started',
  'Practical Info':     'Everyday Life',
}
