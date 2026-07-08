const { withPostHogConfig } = require('@posthog/nextjs-config')

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

// Upload browser source maps to PostHog error tracking so client exceptions
// get readable, symbolicated stack traces instead of minified frames. Runs
// during the local `next build`; deleteAfterUpload keeps the maps out of the
// deployed bundle.
//
// GUARDED on POSTHOG_API_KEY — a personal API key (scopes: "error tracking
// write" + "organization read") set in .env.local on the build machine. Until
// that env var is present this is a complete no-op and the build is unchanged.
module.exports = process.env.POSTHOG_API_KEY
  ? withPostHogConfig(nextConfig, {
      personalApiKey: process.env.POSTHOG_API_KEY,
      projectId:      process.env.POSTHOG_PROJECT_ID || '185891',
      host:           'https://eu.posthog.com',
      sourcemaps:     { enabled: true, deleteAfterUpload: true },
    })
  : nextConfig
