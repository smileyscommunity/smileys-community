// ── JSON-LD script-tag escaping, in one place ──
// Embedding JSON in a <script type="application/ld+json"> block is safe ONLY
// if `<` can never appear literally — a value containing `</script>` would
// otherwise close the tag and execute whatever follows (stored XSS through,
// say, a club description). The U+2028/2029 escapes keep the payload valid
// JS source for parsers that treat those as line terminators.
//
// This exact 3-replace chain existed as 9 hand-pasted copies (3 of them a
// local helper literally named the same thing). XSS-adjacent escaping gets
// one owner; the next hardening lands everywhere at once.
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
