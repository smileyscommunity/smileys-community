// Paid-relationship label for an article (Post.disclosure). One list for the
// editor, the API validator and the public page, so a value the editor can
// save is always one the page can render. Null means "nothing to disclose":
// the page shows no label, and nothing is inferred from the article's content.

export const DISCLOSURES = [
  { value: 'sponsored', label: 'Sponsored content', text: 'This article is sponsored: Smileys Community was paid or otherwise compensated for it.' },
  { value: 'affiliate', label: 'Affiliate links',   text: 'This article contains affiliate links: Smileys Community may earn a commission if you buy through them, at no extra cost to you.' },
] as const

export type Disclosure = (typeof DISCLOSURES)[number]['value']

export function getDisclosure(v: unknown) {
  return DISCLOSURES.find(d => d.value === v) ?? null
}

/** undefined = leave the column alone; null or '' = clear; otherwise must be a known value. */
export function validateDisclosureInput(v: unknown):
  { ok: true; data: Disclosure | null | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, data: undefined }
  if (v === null || v === '') return { ok: true, data: null }
  const d = getDisclosure(v)
  return d ? { ok: true, data: d.value } : { ok: false, error: 'Disclosure must be "sponsored", "affiliate" or empty.' }
}
