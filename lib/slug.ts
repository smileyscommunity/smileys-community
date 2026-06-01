// URL-safe slug from a human-readable name. Standard pattern:
// lowercase, non-alphanumerics → hyphens, collapse runs, trim ends.
// Used by admin create flows (clubs, posts, campaigns) so trailing
// whitespace ("Women ") or punctuation ("Comedy!") don't produce
// "women-" / "comedy-" with a dangling hyphen.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
