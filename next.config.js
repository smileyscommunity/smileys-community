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
    // Next's default is 60s, so every optimized image response re-validates
    // almost immediately. These are static brand/content assets that rarely
    // change in place — 30 days gives real caching wins for repeat visits.
    // If a file IS swapped in place, bump its query string (?v=N, matching
    // the OG-image cache-busting convention already used elsewhere) or
    // rename it — don't rely on this expiring on its own.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    // No source asset in the repo is wider than ~1600px (heroes are
    // 1200–1536), so the default 3840 breakpoint only produces
    // pointless max-width optimizer requests on retina desktops.
    // Capping at 1920 keeps every real variant.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
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
      // /listings → /board rename. Permanent 308 so bookmarks, Google's index,
      // and old email/notification deep-links keep landing on the renamed
      // section instead of 404'ing. Does not touch /api/listings (data API)
      // or /admin/listings, which keep their internal names.
      {
        source:      '/listings',
        destination: '/board',
        permanent:   true,
      },
      {
        source:      '/listings/:path*',
        destination: '/board/:path*',
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
//
// ALSO GUARDED on UPLOAD_SOURCEMAPS=1 — measured at ~52s/deploy (re-uploads
// every symbol set in the app, not just what changed) with zero benefit
// unless you're actively about to debug a production JS error. Opt in with
// `UPLOAD_SOURCEMAPS=1 ./deploy.sh` right before/after a release you expect
// to need readable stack traces for; routine deploys skip it by default.
//
// Also guarded against `next dev`: the sourcemap step races the incremental
// compiler and corrupts the build dir. Sourcemap upload only makes sense for
// the production build anyway.
//
// deleteAfterUpload is intentionally FALSE. When true, PostHog sweeps the
// uploaded .map files out of .next at the end of the build — that deletion
// runs concurrently with Next's own final file moves (export → server) and
// intermittently kills the build with `ENOENT: rename .next/export/500.html`.
// Leaving the maps in place removes the race entirely; the maps are already
// uploaded to PostHog by then, and deploy.sh's rsync excludes `*.map` so the
// retained (hidden, non-served) server maps never ship to prod.
module.exports = process.env.POSTHOG_API_KEY && process.env.UPLOAD_SOURCEMAPS === '1' && process.env.NODE_ENV !== 'development'
  ? withPostHogConfig(nextConfig, {
      personalApiKey: process.env.POSTHOG_API_KEY,
      projectId:      process.env.POSTHOG_PROJECT_ID || '185891',
      host:           'https://eu.posthog.com',
      sourcemaps:     { enabled: true, deleteAfterUpload: false },
    })
  : nextConfig
