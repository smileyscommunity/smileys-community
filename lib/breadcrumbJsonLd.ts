// BreadcrumbList for a public page. The trail is the one the page itself
// shows (or would): Google matches the markup to the visible path, so every
// item is a real URL a reader can click, and the last one is the page.

export interface Crumb { name: string; url: string }

export function breadcrumbJsonLd(items: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: c.url,
    })),
  }
}
