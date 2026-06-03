# Security model

This document exists so a future contributor (or future you) doesn't
unwind the audit work in commits `2fc5e75` through `22d2bc4`. It explains
the threat model, names the files that encode each defense, and calls out
the load-bearing invariants — patterns that look removable but aren't.

Read this before:
- Adding a new API route
- Changing `middleware.ts`, `app/layout.tsx`, `lib/session.ts`,
  `lib/sanitize.ts`, `lib/email.ts`, `lib/access.ts`, or anything under
  `app/api/auth/`
- Adding a new user-content surface (anywhere user-typed strings end up
  in HTML, emails, or links)
- Reviewing a PR that touches CSP / cookies / database access patterns

---

## Reporting a vulnerability

Email `info@smileyscommunity.com` with subject `[security]`. Do not file
a public GitHub issue. We'll respond within 48 hours.

If you're an admin who's lost access to your 2FA device, contact a
second admin — there are no self-service backup codes today (see Open
gaps below).

---

## Threat model

### Who we're defending against

1. **A registered member trying to access another member's PII, posts,
   or sessions.** Realistic and motivated. Defended via IDOR scoping on
   every per-resource route, central capability helpers in
   `lib/access.ts`, and field allowlists on PATCH endpoints.

2. **A registered member trying to elevate to moderator or admin.**
   Defended via role check on every admin route, city-scope check on
   moderator routes, and an enum allowlist on the PATCH that sets `role`.

3. **An external attacker brute-forcing login or password reset.**
   Defended via Turnstile gates, per-IP rate limits, per-account
   `failedLoginCount` lockouts, and constant-time bcrypt comparisons
   that don't leak whether the email exists.

4. **An external attacker exploiting stored XSS via user content.**
   Defended via input sanitization (`lib/sanitize.ts`), HTML escaping
   in emails (`lib/email.ts`), JSON-LD `</script>` escapes,
   URL-protocol allowlists (`lib/safeUrl.ts`), and a nonce-based CSP
   with `strict-dynamic` so any unnonced injected script is blocked
   by modern browsers.

5. **A leaked database backup or read-only DB compromise.** Defended
   via bcrypt password hashes, SHA-256 hashed reset/verification tokens
   (`lib/tokenHash.ts`), and AES-256-GCM encrypted TOTP secrets
   (`lib/totpCrypto.ts`). A DB dump alone does not yield working
   credentials or 2FA bypass.

6. **A stolen session cookie.** Mitigated via `tokenVersion` (logout
   bumps it, invalidating every active session for that user),
   real-time DB checks on every `getSession()` call (ban/suspension
   surface immediately), and `sameSite: 'lax'` + `secure` + `httpOnly`
   on the cookie itself. Not eliminated — see Open gaps.

7. **CSRF against state-changing API calls.** Defended via Origin /
   Referer host-match check in `middleware.ts` on every POST/PUT/PATCH/
   DELETE to `/api/*`. Same-origin browser fetches always satisfy; a
   cross-site form submission without a forged Origin won't.

### Who we're NOT defending against

- **Root-level server compromise** (rsync-based deploy to a single
  Hetzner box; if root is owned, game over). This is a deployment
  topology choice, not a code property.
- **Compromise of Resend / Cloudflare / Sentry / OpenAI keys.** Rotation
  is a process problem, not a code defense.
- **Sustained network-level DDoS.** App-layer rate limits and Turnstile
  are the only mitigations in code.
- **Targeted attacks on individual users** (SIM swap of an admin's
  recovery number, etc.). Process problem.

---

## Defenses by surface

### Authentication — `app/api/auth/`, `lib/session.ts`, `lib/turnstile.ts`

- **Password hashing**: bcrypt cost 10. See `app/api/auth/login/route.ts`.
- **Login enumeration mitigation**: `TIMING_GUARD_HASH` is `bcrypt.compare`'d
  on the missing-user code path so wall-clock time is indistinguishable
  from a wrong-password response. `login/route.ts:17-51`.
- **Lockout**: 10 failed attempts → 1h `loginLockedUntil`. The 429 message
  is identical to the IP rate-limit 429 so an attacker can't probe past
  10 to enumerate accounts.
- **IP rate limits** (`lib/rateLimit.ts`):
  - login: 5/15min/IP
  - register: 5/hour/IP
  - forgot-password: 5/10min/IP
  - resend-verification: 3/10min/IP
  - reset-password: 5/15min/IP
  - activate (GET + POST): 10/min/IP
  - 2FA verify: 5/15min/IP
  - 2FA setup (POST + DELETE): 5/15min/session.id
- **Turnstile** (`lib/turnstile.ts`): gates login, register, forgot-password,
  apply, appeal, contact. **Fails closed in production** when
  `TURNSTILE_SECRET_KEY` is unset — never silently disabled.
- **TOTP 2FA**:
  - Secret encrypted at rest with AES-256-GCM, key from `TOTP_ENCRYPTION_KEY`
    env. `lib/totpCrypto.ts`.
  - Replay protection via `lastUsedTotpStep`. A 6-digit code valid for
    30s can only be used once.
  - Both admins and moderators can enroll. Members cannot.
- **Tokens at rest** (`lib/tokenHash.ts`): password reset, email
  verification, and activation tokens are stored as SHA-256 hashes.
  The plaintext is emailed; the DB never sees it. A read-only DB leak
  cannot be turned into account takeover.
- **Session JWT** (`lib/session.ts`):
  - HS256, 7-day expiry, signed with `JWT_SECRET`.
  - Cookie: `httpOnly`, `sameSite: 'lax'`, `secure` in prod, scope `/`.
  - `getSession()` does a real-time DB check on every call: status,
    suspendedUntil, tokenVersion. Ban/suspension surfaces immediately
    without waiting for the JWT to expire.
  - `tokenVersion` bumped on: logout, password reset, email change.
    Every existing session for that user becomes invalid.

### Authorization — `lib/access.ts`

- **Capability helpers** are centralized. Every admin route imports
  `canManageUsers` / `canManagePayments` / `canSendBroadcasts` /
  `canModerateEventQueue` / etc. — don't add new routes that inline
  their own role check.
- **City scoping**: capability helpers take an optional `targetCityId`.
  Pass it for any city-bound resource — moderators are limited to
  their own city; admins act globally.
- **IDOR scoping pattern** (see `app/api/clubs/[slug]/posts/[postId]/route.ts`):
  for any per-resource route that takes both a parent identifier in
  the URL (e.g. `slug`) and a child identifier (e.g. `postId`), look up
  both and assert the child belongs to the parent before mutating.
  Without this, a member of public club A can mutate posts in private
  club B by passing `/api/clubs/A/posts/<B-post-id>`.
- **Field allowlists on PATCH**: every admin PATCH on a sensitive
  field (role, status, membershipType, club-membership role/status)
  validates against a closed enum. See
  `app/api/admin/users/[id]/route.ts` and
  `app/api/admin/clubs/[id]/memberships/route.ts`.

### Input handling

- **TipTap rich text** (club posts, event descriptions, listings):
  rendered via `dangerouslySetInnerHTML` AFTER passing through
  `lib/sanitize.ts` — sanitize-html with a strict tag/attribute/URL-
  scheme allowlist. Don't broaden the allowlist without a security
  review.
- **Emails** (`lib/email.ts`):
  - `esc(s)` HTML-escapes user/host-supplied strings before they land
    in template literals.
  - `safeSubject(s)` strips CR/LF (header injection).
  - Every interpolated `${name}` / `${eventTitle}` / `${listing.title}`
    etc. goes through `esc()`. The bodyHtml in `sendBroadcastEmail`
    paragraph-wraps `esc(p).replace(/\n/g, '<br>')` — escape THEN
    insert `<br>`, never the other way around.
- **JSON-LD** (`app/events/[id]/page.tsx`): the `JSON.stringify` output
  is post-processed to escape `<` and U+2028 / U+2029, otherwise a
  host with `</script><script>alert(1)` in their event title breaks
  out of the `<script type="application/ld+json">` block.
- **URL fields** (`lib/safeUrl.ts` `isSafeHref`): banner links, sponsor
  websiteUrl / logoUrl / instagramUrl, partner website / instagram all
  validate scheme before storage. Only `https://`, `mailto:`, and
  `/relative` paths pass. Whitespace and control chars rejected
  (defeats `\tjavascript:` tricks).
- **File uploads** (`app/api/upload/route.ts`, `app/api/apply/upload/route.ts`):
  - Magic-byte sniff via `lib/imageMagic.ts` before Sharp.
  - Sharp `.jpeg()` re-encode strips EXIF (including GPS) by default.
    Don't add `.withMetadata()`.
  - Server-generated filenames + allowlisted subfolders. No user input
    in the path.
- **Prisma**: no `$queryRawUnsafe` / `$executeRawUnsafe` in the
  codebase. The few `$queryRaw` call sites use tagged-template
  parameterization (rate limit, health check, cron secret check, event
  RSVP transaction). Keep it that way.

### Transport — `next.config.js`, `middleware.ts`

- **HSTS**: `max-age=63072000; includeSubDomains` (2y). Set in
  `next.config.js`. No `preload` yet — that's a one-way hstspreload.org
  commitment.
- **CSP**: nonce + `strict-dynamic` via `middleware.ts`, per-request.
  - Modern browsers ignore `'unsafe-inline'` / `'self'` / host
    allowlists when `'strict-dynamic'` + a valid nonce are present.
    Only the per-request nonce'd scripts (and what they dynamically
    load) execute. Stored XSS that injects `<script>...</script>`
    without the nonce is blocked.
  - `'unsafe-inline'` is kept as legacy-browser fallback. `'unsafe-eval'`
    is kept because PostHog session replay and Sentry breadcrumbs use
    `Function()` / `eval`.
  - **Both the request and response CSP headers carry the nonce.**
    Next.js reads from the request header to apply the nonce to its
    own inline bootstrap and `<script src>` tags.
  - Violations are reported to `/api/csp-report`. Grep
    `[csp-violation]` in PM2 logs.
- **Other headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **CSRF**: `middleware.ts` checks Origin/Referer host equals request
  host on every POST/PUT/PATCH/DELETE to `/api/*`. Exemptions:
  `/api/csp-report` (browsers don't send Origin on report POSTs).
- **Cookies**: `sameSite: 'lax'`, `httpOnly`, `secure` in prod. See
  `lib/session.ts`.

### Operational visibility

- **Audit log** (`lib/audit.ts` → `writeAudit`): admin status changes,
  role changes, suspensions, deletions, payment refunds. Surface via
  the admin `Audit` view.
- **Email failures**: `recordEmailFailure` in `lib/email.ts` writes to
  the `EmailFailure` table. Admin dashboard tile surfaces the 24h
  count.
- **CSP violations**: grep `[csp-violation]` in
  `/root/.pm2/logs/smileys-out.log`. Browser-extension noise
  (`chrome-extension://`, `moz-extension://`,
  `safari-web-extension://`) is filtered out at the report endpoint.
- **Cron run logs**: `recordCronRun` + the admin Crons panel.
- **Sentry**: client + server `instrumentation*.ts` strip auth-bearing
  query params (`?token=`, `?secret=`, `?code=`, `?access_token=`,
  `?refresh_token=`) and `Cookie` / `Authorization` / `X-CSRF` /
  `X-API-Key` headers before sending events. `sendDefaultPii: false`
  is pinned explicitly.
- **Pre-deploy smoke test** (`scripts/smoke.sh`): asserts CSP nonce
  wired, HSTS present, every rendered `<script>` has a nonce, login
  returns 200. Catches the round-4 static-rendering regression class
  before deploy.

---

## Load-bearing invariants — do not undo

These look like they could be simplified. They cannot.

1. **`app/layout.tsx` is async and calls `await headers()`.** This forces
   every page to dynamic rendering. If you make the layout sync again,
   Next.js falls back to static rendering for pages that don't import
   `headers()`/`cookies()`. The per-request nonce stops being applied to
   the inline `<script>` tags those pages emit. Modern browsers then
   block every script under `'strict-dynamic'` and the app appears
   broken.

2. **`middleware.ts` sets the CSP header on BOTH the request and the
   response.** Next.js reads from the **request** header to know which
   nonce to stamp onto its scripts. If you only set the response header,
   nothing breaks immediately but the nonce on script tags goes stale
   on the next deploy and the app silently breaks on modern browsers.
   The smoke test catches this.

3. **`bcrypt.compare(password, TIMING_GUARD_HASH)` on the missing-user
   path in `login/route.ts:50`.** Don't optimize it away. It exists
   purely to equalize wall-clock time so attackers can't enumerate
   accounts.

4. **`lib/sanitize.ts` allowlist stays strict.** Don't add `<style>`,
   `<iframe>`, `<script>`, `<form>`, `on*` attributes, `javascript:`/
   `data:` URLs, or arbitrary `class` / `style`. Each one is a known
   stored-XSS vector.

5. **`lib/email.ts esc()` wraps every interpolated user/host string.**
   New email templates must follow the same pattern. A future
   `sendListingAlertEmail`-style fan-out without `esc()` ships HTML
   injection at scale to whoever subscribed.

6. **Sharp `.jpeg()` re-encode in both upload routes.** Don't add
   `.withMetadata()` — that re-attaches EXIF, including GPS coords on
   mobile photos. Don't replace Sharp with a direct write of the
   uploaded buffer — magic-byte sniff alone doesn't prevent every
   format quirk.

7. **`getSession()` real-time DB check** (`lib/session.ts:54`). It
   refreshes `status`, `suspendedUntil`, `tokenVersion`, `cityId`,
   `email` on every call. Caching this — even per-request — defeats
   the ban/suspension surface.

8. **`TOTP_ENCRYPTION_KEY` env var in production.** Without it,
   `encryptTotpSecret()` throws on new 2FA enrollments. The
   backward-compat decrypt path lets existing pre-encryption secrets
   keep working; once every admin/mod has re-enrolled, the legacy path
   can be removed. Don't rotate the key without a backward-compat
   migration.

9. **Cron secret comparison uses `crypto.timingSafeEqual`**
   (`lib/cronAuth.ts`). Don't go back to `!==`. The entropy makes
   timing attacks impractical but the cost of constant-time is zero.

10. **CSP `report-uri` directive in `middleware.ts`** pointing at
    `/api/csp-report`. Removing it means a silent CSP regression
    (`app/layout.tsx` going sync, middleware no longer setting the
    request CSP header, etc.) ships to prod with no signal. The smoke
    test catches some of these but not all.

12. **`OFFLINE_APIS` in `public/sw.js` is empty by design.** Caching
    auth-bearing responses in the shared CACHE could leak User A's
    data to User B on a shared device. If a future offline-mode
    feature is needed, scope it to a per-user cache name
    (e.g. `auth-${userId}`) generated at login.

13. **Backup-code consumption is atomic via
    `prisma.totpBackupCode.updateMany`**, not a findUnique + update.
    The atomicity is load-bearing: a findUnique + update is a TOCTOU
    race where two concurrent requests with the same code can both
    mint sessions. Same goes for any future single-use credential.

14. **TOTP replay protection (`lastUsedTotpStep`) is checked AND
    bumped on every TOTP-accepting route**: `/verify`, `/setup` DELETE,
    `/backup-codes` POST. Without this, a shoulder-surfed TOTP at
    login could be replayed within the same 30s step against the
    other routes to disable 2FA or rotate recovery codes.

11. **`/api/csp-report` is exempted from the CSRF Origin check in
    middleware.** Don't put the CSRF check back in for that path —
    browsers don't reliably send Origin on report POSTs and there's
    no session-bound state to forge.

---

## Open gaps — honestly enumerated

Known, not yet addressed:

- ~~**2FA backup codes.**~~ *Closed.* 10 codes generated at enrollment
  via `lib/totpBackupCodes.ts`, hash-stored, accepted at 2FA verify as
  alternative to TOTP. Regenerate endpoint at
  `POST /api/auth/2fa/backup-codes` requires a fresh TOTP code.
- ~~**Account deletion cascade not end-to-end audited.**~~ *Closed.*
  `/auth/delete-account` now runs a comprehensive anonymize-and-clear
  transaction: hard-deletes PII / inbox / tracking, anonymizes
  user-authored content in shared threads, scrubs every tracking field
  on the User row. Payment / EventAttendee / Review preserved
  deliberately for business records.
- ~~**7-day JWT session, no refresh rotation.**~~ *Partially closed.*
  A `Session` table now tracks every issued JWT by its `jti`. Each
  device has its own row (userAgent/ip/createdAt/lastUsedAt); users
  can list them at `GET /api/auth/sessions` and revoke individual
  devices at `DELETE /api/auth/sessions/[id]`. `getSession()` rejects
  any JWT whose `jti` row is missing, revoked, or past expiry.
  Legacy JWTs issued before this column (no `jti`) keep working until
  their 7-day expiry; after that the backward-compat path can be
  removed. The 7-day TTL itself is unchanged — refresh-token rotation
  would shorten the stolen-cookie blast radius further but adds
  meaningful flow complexity.
- **2FA optional for admins/mods.** Audit recommended mandatory; not
  done because it's a UX decision (where's the enrollment prompt? what
  happens on failed enrollment?).
- ~~**Webhook signature verification.**~~ *Closed to the extent
  possible today.* No inbound webhook endpoints exist in this codebase
  as of the audit. A reusable HMAC-SHA256 verification helper lives at
  `lib/webhookSig.ts` — the first webhook a contributor adds should
  use it (or a provider-specific equivalent like `stripe.webhooks.
  constructEvent`). Read the comments in that file before adding a
  new webhook route: raw body must be passed to `req.text()` not
  `req.json()`, and `fail closed when secret env is unset`.
- ~~**WebPush payload validation.**~~ *Closed.* `lib/push.ts` now
  sanitizes title/body (strips ASCII control chars, zero-width
  spaces, and bidi-override unicode — the classic RTL spoof for
  notifications), caps length (80/200/500 for title/body/link),
  validates `link` against an allowlist (must be a same-origin
  absolute path, no `javascript:` / `https://evil` / `//proto-rel`),
  and caps fan-out at 20 subscriptions per user per send.
- **CDN cache-control on private API responses** — `/api/auth/me`
  etc. should never be cached cross-user. The deploy pipeline is
  direct rsync to Hetzner with no CDN in front, so this is theoretical
  today; would matter if a CDN layer is added.
- **Audit log retention** — the `Audit` table grows forever. No
  rotation policy.
- **Dependabot / renovate** — `npm audit` is clean today, won't be
  next month. No automation in CI.

---

## Adding a new feature: the checklist

When you add a new API route or feature, walk through this:

- [ ] Does it accept user input? If yes, decide where the input goes
      (rendered HTML, email, URL field) and use the appropriate
      escape/sanitize/allowlist helper.
- [ ] Does it mutate state? If yes, add to the right rate-limit bucket
      and ensure middleware's CSRF Origin check covers it (it should
      automatically if it's under `/api/*`).
- [ ] Does it read or write per-user data? If yes, scope every Prisma
      `where` by `session.id` for member routes, or by the parent
      object's ownership for nested routes.
- [ ] Does it require admin or moderator role? If yes, use the
      capability helper from `lib/access.ts` — don't inline the check.
      For city-bound resources, pass `targetCityId`.
- [ ] Does it accept an ID in the URL that nests under another ID
      (`/clubs/[slug]/posts/[postId]`)? If yes, look up both, assert
      the child belongs to the parent, before mutating.
- [ ] Does it accept a field like `role`, `status`, `membershipType`,
      or anything else that drives capability? Validate against a
      closed enum allowlist.
- [ ] Does it send email? Use `esc()` on every user/host-supplied
      interpolation and `safeSubject()` on the subject.
- [ ] Does it render an inline `<script>`? Read the nonce from
      `(await headers()).get('x-nonce')` and apply it.
- [ ] Does it accept a URL field that will be rendered as `<a href>` or
      `<img src>`? Validate with `isSafeHref` before storage.
- [ ] Does it accept a file upload? Use the existing upload routes if
      possible. If you must write a new one, copy the magic-byte sniff
      + Sharp pipeline from `app/api/upload/route.ts`.
- [ ] Does it expose new fields on a user object in an API response?
      Audit which roles can see the response — make sure
      `passwordHash`, `totpSecret`, raw `email` (for non-admin viewers
      of other members), `lastFingerprint`, `knownIps` aren't leaking.

If you can't answer any of these confidently, ask. The audit notes
across commits `2fc5e75`..`22d2bc4` have the full reasoning.
