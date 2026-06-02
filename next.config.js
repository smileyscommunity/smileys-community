const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/app',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'smileyscommunity.com',
      },
    ],
  },
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },
  async redirects() {
    return [
      // Legacy /admin/cup → consolidated into /admin/campaigns. The
      // Smileys Cup is one campaign among many now, with fixture
      // management surfaced as the "Fixtures + results" tab on the
      // campaign-detail page. Permanent 308 so bookmarks and old
      // notification links from before the deletion still land
      // somewhere useful instead of 404'ing.
      {
        source:      '/admin/cup',
        destination: '/admin/campaigns',
        permanent:   true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control',     value: 'on' },
          // HSTS — pin smileyscommunity.com to HTTPS for 2 years (incl. subdomains).
          // No `preload` because that's a one-way commitment that needs a separate
          // submission to hstspreload.org; add it later if you want.
          { key: 'Strict-Transport-Security',  value: 'max-age=63072000; includeSubDomains' },
          {
            key:   'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://images.unsplash.com https://smileyscommunity.com https://*.tile.openstreetmap.org https://unpkg.com",
              "connect-src 'self' https://challenges.cloudflare.com https://*.tile.openstreetmap.org https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
              "font-src 'self' data:",
              "frame-src https://challenges.cloudflare.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
})
