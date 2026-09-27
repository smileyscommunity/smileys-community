// What the rich-text editor writes into a link's href.
//
// The public renderer (lib/sanitize sanitizeArticle) allows https and mailto
// only, so an `http://` link a staff member pasted survived the editor and
// the save and then rendered as plain text on the article — a silent break,
// in the safe direction but silent. Every site the Handbook cites serves
// https, so the scheme is upgraded here rather than rejected.
export function normalizeLinkHref(raw: string): string {
  const url = raw.trim()
  if (!url) return ''
  if (/^mailto:/i.test(url)) return url
  return `https://${url.replace(/^https?:\/\//i, '')}`
}
