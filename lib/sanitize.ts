import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'blockquote', 'a', 'img', 'hr', 'span',
]

const ALLOWED_ATTR: sanitizeHtml.IOptions['allowedAttributes'] = {
  a:   ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  '*': ['class'],
}

export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags:       ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTR,
    allowedSchemes:    ['https', 'http', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  })
}
