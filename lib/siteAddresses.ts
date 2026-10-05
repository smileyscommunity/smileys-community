// Admin-edited text (the FAQ in content.json) writes addresses as plain
// text — "smileyscommunity.com/app/settings". Split a string into plain
// segments and in-app link segments so a page can render the addresses as
// links. The path is relative to the basePath (/app is dropped); the query
// string is kept; a sentence's closing punctuation is not part of the link.
export type AddressSegment = { text: string; href?: string }

// "/app" is the basePath only as a whole segment — "/apply" and "/appeal"
// start with the same letters and are paths of their own.
const SITE_ADDRESS = /smileyscommunity\.com(?:\/app(?![\w-]))?(\/[\w\-/]*(?:\?[\w=&\-]*)?)?/g

export function splitSiteAddresses(s: string): AddressSegment[] {
  const out: AddressSegment[] = []
  let last = 0
  for (const m of s.matchAll(SITE_ADDRESS)) {
    const start = m.index ?? 0
    let text = m[0]
    let href = m[1] || '/'
    while (/[.,;:]$/.test(text)) { text = text.slice(0, -1); href = href.replace(/[.,;:]$/, '') || '/' }
    if (start > last) out.push({ text: s.slice(last, start) })
    out.push({ text, href })
    last = start + text.length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}
