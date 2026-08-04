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
export const HANDBOOK_TO_GUIDE: Record<string, { anchor: string; label: string }> = {
  'Bureaucracy':    { anchor: 'visa-residence',   label: 'Visa & Residence apps and links' },
  'Money':          { anchor: 'banking-money',    label: 'Banking & Money apps and links' },
  'Daily Life':     { anchor: 'housing',          label: 'Housing, utilities, and daily essentials' },
  'Family':         { anchor: 'healthcare',       label: 'Healthcare quick links' },
  'Getting Around': { anchor: 'getting-around',   label: 'Getting Around apps and links' },
}

// City Guide section label → Handbook category. Inverse mapping used
// when rendering "Read the deep dive →" on /guide sections that have
// a matching long-form article category.
export const GUIDE_TO_HANDBOOK: Record<string, string> = {
  'Visa & Residence':   'Bureaucracy',
  'Banking & Money':    'Money',
  'Housing':            'Daily Life',
  'Healthcare':         'Daily Life',
  'Mobile & Internet':  'Daily Life',
  'Getting Around':     'Getting Around',
}
