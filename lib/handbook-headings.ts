// Promote the Handbook's fake section headings to real ones.
//
// Every existing article was written in the rich-text editor using bold
// paragraphs as headings — `<p><strong>Where to Buy an İstanbulkart</strong></p>`
// — so the corpus contains zero <h2>/<h3>. That blocks a table of contents,
// leaves screen-reader users without a document outline, and hands search
// engines a wall of undifferentiated <p>.
//
// The transform is deliberately conservative: a paragraph is promoted only when
// it is ENTIRELY one <strong> AND reads like a heading. Turning body copy into
// a heading is a worse outcome than leaving a heading un-promoted, so every
// ambiguous case is left alone for a human editor.
//
// Pure and side-effect free so it can be tested against the real corpus before
// it is ever pointed at the database (see scripts/archive/migrate-handbook-headings.ts).

// A whole paragraph that is nothing but one <strong>. The inner group refuses
// to cross a </strong>, <p> or <strong> boundary so two adjacent paragraphs
// can never be swallowed as one match.
export const PSEUDO_HEADING = /<p>\s*<strong>((?:(?!<\/strong>|<p>|<strong>).)*?)<\/strong>\s*<\/p>/gi

export const MAX_HEADING_CHARS = 80

/** Does this bolded paragraph read like a section heading rather than an
 *  emphasised sentence? */
export function looksLikeHeading(inner: string): boolean {
  // Any inner markup (a link, a nested tag, a stray <br>) means this isn't the
  // simple shape we're confident about.
  if (/<[^>]+>/.test(inner)) return false
  const text = inner.replace(/&nbsp;/gi, ' ').trim()
  if (!text) return false
  if (text.length > MAX_HEADING_CHARS) return false
  // Headings don't end in sentence punctuation; bolded lead-in sentences do.
  // '?' is deliberately allowed — question-form headings are idiomatic in
  // practical writing ("Need Help?", "Can I Use My Bank Card Instead?") and
  // excluding it demoted real headings in the live corpus.
  if (/[.!,;:]$/.test(text)) return false
  return true
}

function decode(inner: string): string {
  return inner.replace(/&nbsp;/gi, ' ').trim()
}

export type HeadingChange = { text: string; level: 2 | 3 }

/** Rewrite pseudo-headings as real headings.
 *
 *  Level: a pseudo-heading whose text repeats within the same article is
 *  subordinate by definition (the scams article repeats "Stay safe" under each
 *  of its 16 scams), so repeats become <h3> and everything else <h2>.
 *
 *  Idempotent — after one pass no qualifying paragraph remains, so a second
 *  pass reports no changes. */
export function migrateHeadings(body: string): { body: string; changes: HeadingChange[] } {
  // Pass 1 — count qualifying heading texts so repeats can be demoted.
  const counts = new Map<string, number>()
  for (const m of body.matchAll(PSEUDO_HEADING)) {
    if (!looksLikeHeading(m[1])) continue
    const key = decode(m[1]).toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // Pass 2 — rewrite.
  const changes: HeadingChange[] = []
  const out = body.replace(PSEUDO_HEADING, (full, inner: string) => {
    if (!looksLikeHeading(inner)) return full
    const text  = decode(inner)
    const level: 2 | 3 = (counts.get(text.toLowerCase()) ?? 0) > 1 ? 3 : 2
    changes.push({ text, level })
    return `<h${level}>${text}</h${level}>`
  })
  return { body: out, changes }
}
