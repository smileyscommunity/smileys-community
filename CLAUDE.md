# Smileys Community — Agent Guide

Curated social community platform (Istanbul; expats, nomads, travelers, locals). **Quality > quantity, real-life connection over vanity metrics, no spam / no addictive feed loops.** Weigh every feature against whether it serves real-world connection.

## Stack
- **Next.js 15** App Router + API routes · **React 18** · TypeScript · Tailwind
- **Prisma v7** (`@prisma/adapter-pg`) → **PostgreSQL** on Hetzner
- Auth: **JWT via jose**, httpOnly cookie `smileys_session` · **basePath `/app`**
- Server: Hetzner `178.105.37.133`, **PM2** (`smileys`), port 3000 · Email via **Resend** · Web push (VAPID)
- Roles: `member` · `moderator` · `host` · `admin` (helpers in `lib/access.ts`)

## Commands
```bash
npm run dev            # local dev
npm run build          # production build (also run before deploy)
npm test               # vitest (tests/*.test.ts)
npx tsc --noEmit       # typecheck — run after every change
npm run lint           # next lint
```
Always `npx tsc --noEmit` (and `npm test` when logic changed) before considering a change done.

## Deploy — READ BEFORE DEPLOYING
- **NEVER run `./deploy.sh` without the user's explicit confirmation for that specific deploy.** Make the change, verify, then stop and ask.
- **Never run two deploys in parallel** (also watch for a second Claude session) — overlapping deploys corrupt `.next` and take the site down.
- `deploy.sh` builds locally → smoke-tests → `rsync` → graceful PM2 restart. It **excludes `.env`, `.env.local`, `.env.production`** — never deploy local env files (`.env.local` overrides server `.env` and breaks prod URLs).
- Backups: server-side daily cron dumps to `/root/db-backups` (kept 14) — outside the repo so `rsync --delete` can't wipe them.

## Layout
- `app/` — routes + `app/api/**`. Public (unauthenticated) surfaces: `app/events`, `app/directory`, `app/board` (community board; served by the kept `/api/listings` API) + their APIs — these MUST redact guest data.
- `lib/` — `access.ts` (authz), `session.ts` (auth), `db.ts` (event/club queries), `sanitize.ts`, `safeUrl.ts`, `rateLimit.ts` (DB-backed), `email.ts`, `notify.ts`, `memberPrivacy.ts`, `cup.ts`, `data.ts` (`formatName`, `getInitials`).
- `components/`, `contexts/`, `hooks/`, `prisma/schema.prisma`, `scripts/` (one-off tsx), `tests/`.

## Conventions & gotchas
- **No native `confirm()/alert()/prompt()`** — they silently no-op in the installed PWA. Use `confirmToast` / sonner toast.
- **Time-of-day math:** use `hourCycle:'h23'`, never `hour12:false` (renders midnight as `24:MM` on server ICU → wrong cutoffs).
- **Raw SQL:** columns are **camelCase → must be double-quoted** (`"userId"`, `"memberCount"`). Event `date` is stored as **text** `'YYYY-MM-DD'` (string comparisons).
- **Names:** normalize with `formatName` (conservative — never force-lowercases; don't invent Turkish diacritics).
- **User HTML:** sanitize with `lib/sanitize`. Escaping into a `<script type="application/ld+json">` must `.replace(/</g,'\\u003c')` (prevents `</script>` XSS).
- **Public endpoints:** withhold PII from logged-out viewers via `redact*ForGuest`; respect `profileVisibility='connections'` via `memberPrivacy.restrictedSetFor`.
- **Match surrounding style** — comment density, naming, structure vary by file; follow the file you're editing.

## Server scripts / DB
- Run one-offs on the server with **both** env files: `npx tsx --env-file=.env --env-file=.env.local scripts/<name>.ts` (`.env` has `DATABASE_URL`; `.env.local` has `JWT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`). `scp` the script to `/root/smileys-community/scripts/` to run without a full deploy.
- Prod DB (read/query for data fixes): `ssh root@178.105.37.133` then `psql "$(grep -m1 '^DATABASE_URL' /root/smileys-community/.env | cut -d= -f2- | tr -d '"')"`. The password lives only in the server's `.env` — never paste it into a file, a script, or the crontab (it was committed here until 2026-08-10 and had to be rotated). Guard data mutations with `WHERE id=… AND <current value>` (idempotent) and prefer a `DRY_RUN` path.
- **Schema changes: `prisma migrate deploy`, never `prisma db push` against prod.** `db push` syncs the columns but runs none of the migration's SQL body and records nothing in `_prisma_migrations`. On 2026-08-16 that put three columns into production with no history row and silently skipped a backfill — which was the entire point of the migration that owned it, so testimonials sat unassigned and would have leaked Istanbul's quotes onto every other city's page. It also leaves the history so inconsistent that the next real `migrate deploy` fails trying to re-add an existing column. If columns already exist out-of-band, reconcile with `prisma migrate resolve --applied <name>` (records history without re-running SQL — so run any backfill by hand *first*).
- **Migrations lead the code, never trail it.** Prisma selects every column in a model, so code whose schema knows a column the DB lacks throws P2022 on *every* query for that model — the whole table, not just the new feature. `deploy.sh` refuses to deploy with unapplied migrations for this reason (`ALLOW_PENDING_MIGRATIONS=1` to override).

## Outward-facing actions
Sending email/WhatsApp, deploying, or mutating production data are hard to reverse — **confirm the exact scope with the user first** (count + mechanism). Approval for one action is not standing authorization for the next.
