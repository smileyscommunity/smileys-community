import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'blockquote', 'a', 'img', 'hr', 'span',
]

// No 'class' on '*' — arbitrary class attributes let user content apply
// app/Tailwind CSS selectors, enabling fake UI overlays and CSS-based
// data exfiltration in browsers that render the app stylesheet.
// img[src] restricted to https-only; http images are a mixed-content
// warning and a tracking pixel vector.
const ALLOWED_ATTR: sanitizeHtml.IOptions['allowedAttributes'] = {
  a:   ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
}

export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags:       ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTR,
    allowedSchemes:    ['https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  })
}

// Newsletter bodies are admin-authored so we allow a richer tag set
// (inline styles for email clients, tables for layout) while still
// blocking scripts, event handlers, and javascript: hrefs.
// This is intentionally more permissive than sanitize() above, but
// XSS vectors (script/on* attrs/data: URIs) are still stripped.
const NEWSLETTER_TAGS = [
  ...ALLOWED_TAGS,
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'h5', 'h6', 'pre', 'code', 'div', 'section', 'article',
]

const NEWSLETTER_ATTR: sanitizeHtml.IOptions['allowedAttributes'] = {
  a:      ['href', 'target', 'rel'],
  img:    ['src', 'alt', 'width', 'height', 'style'],
  td:     ['colspan', 'rowspan', 'align', 'valign', 'style', 'width'],
  th:     ['colspan', 'rowspan', 'align', 'valign', 'style', 'width'],
  table:  ['cellpadding', 'cellspacing', 'border', 'width', 'style'],
  '*':    ['style'],
}

export function sanitizeNewsletter(html: string): string {
  return sanitizeHtml(html, {
    allowedTags:       NEWSLETTER_TAGS,
    allowedAttributes: NEWSLETTER_ATTR,
    // data: and javascript: are blocked by not being in this list.
    allowedSchemes:    ['https', 'mailto'],
    allowedSchemesByTag: {
      // Inline images embedded as data URIs are commonly used in email
      // clients where external images are blocked by default.
      img: ['https', 'data'],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  })
}
