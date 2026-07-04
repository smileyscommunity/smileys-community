const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/app',
  experimental: {
    // Next's default 10MB middleware body cap made oversized photo uploads
    // die as "Failed to parse body as FormData" 500s before the upload
    // route's own 5MB check could return a clean error. 20mb matches
    // nginx's client_max_body_size so nginx stays the outer limit and
    // every oversized upload gets an actionable message from our code.
    middlewareClientMaxBodySize: '20mb',
  },
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
          // CSP is set per-request by middleware.ts with a fresh nonce so
          // injected/inline scripts without the nonce are blocked by modern
          // browsers (strict-dynamic). Not configured here.
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
