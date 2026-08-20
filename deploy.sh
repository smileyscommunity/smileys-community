#!/bin/bash
set -e

SERVER="${SMILEYS_DEPLOY_SERVER:-root@178.105.37.133}"
REMOTE="/root/smileys-community"
LOCAL="/Users/nate/smileys-community"
APP_RELEASE=$(git rev-parse --short HEAD)

# Keepalives on every remote call, for the reason backup.sh documents: on
# 2026-08-20 a dump to this same host stalled for over an hour because the TCP
# session died silently and ssh, with no keepalive, waited forever. rsync here
# runs over the same path and had the same hole — a deploy that hangs mid-sync
# holds the lock, blocks the next one, and leaves you guessing whether prod is
# half-written. Probe every 15s, give up after 4 misses.
SSH_OPTS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=20)

# ── One deploy at a time ─────────────────────────────────────────────────────
# Two builds sharing this working directory corrupt .next for BOTH of them. The
# failure lands minutes later as `ENOENT .next/server/pages-manifest.json` or a
# random `PageNotFoundError: Cannot find module for page /<something>` — errors
# that name nothing useful and cost a full rebuild to diagnose. That happened
# six times in one day with two agent sessions in this repo, which is what this
# lock is for.
#
# shlock, not flock: macOS ships no flock(1). shlock records the holder's PID
# and treats a lock whose process is gone as stale, so a killed or crashed
# deploy releases automatically instead of wedging the next one.
LOCK_FILE="${SMILEYS_DEPLOY_LOCK:-/tmp/smileys-deploy.lock}"
if ! /usr/bin/shlock -f "$LOCK_FILE" -p $$; then
  HOLDER=$(tr -d ' \n' < "$LOCK_FILE" 2>/dev/null)
  echo "✗ Refusing to deploy: another deploy is already running (pid ${HOLDER:-unknown})."
  echo "  Wait for it to finish — two builds would corrupt .next for both."
  echo "  If you are certain that process is gone: rm $LOCK_FILE"
  exit 1
fi
# Released on every exit path, including the early refusals below and Ctrl-C.
trap 'rm -f "$LOCK_FILE"' EXIT

# Safety check: rsync --delete will wipe the remote if LOCAL is empty/missing.
# Verify the working copy has the expected anchor files before we trust it.
for anchor in package.json next.config.js app prisma/schema.prisma; do
  if [ ! -e "$LOCAL/$anchor" ]; then
    echo "✗ Refusing to deploy: $LOCAL/$anchor is missing. Aborting before rsync --delete wipes prod."
    exit 1
  fi
done

# Require a non-trivial amount of source so a corrupt clone can't pass anchor check.
FILE_COUNT=$(find "$LOCAL/app" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "${FILE_COUNT:-0}" -lt 50 ]; then
  echo "✗ Refusing to deploy: only $FILE_COUNT files under app/ (expected 50+). Aborting."
  exit 1
fi

# This script builds from the WORKING TREE, not from HEAD — but stamps the
# release with HEAD's sha. Anything uncommitted therefore ships under a label
# that does not contain it, which is invisible afterwards: the commit log looks
# right and the server disagrees.
#
# That is not hypothetical. On 2026-08-16 it happened twice in one evening —
# a whole soldOut feature (plus its unapplied migration) and an areaServed
# change both reached production without appearing in any commit, and were
# found only by grepping the server. Untracked files count too: lib/soldOut.ts
# was untracked and shipped anyway.
#
# So: refuse by default. Deploying a dirty tree on purpose is legitimate
# (a hotfix you have not committed yet), hence ALLOW_DIRTY=1 — which still
# prints exactly what is riding along, so it is a decision rather than an
# accident. Checked before the network calls below so it costs nothing.
DIRTY=$(git status --porcelain 2>/dev/null || true)
if [ -n "$DIRTY" ]; then
  if [ -n "$ALLOW_DIRTY" ]; then
    echo "⚠ Deploying a DIRTY working tree (ALLOW_DIRTY=1)."
    echo "  Release will be stamped $APP_RELEASE, which does NOT contain:"
    echo "$DIRTY" | sed 's/^/    /'
  else
    echo "✗ Refusing to deploy: the working tree is not clean."
    echo "  deploy.sh builds from the working tree, so the following would ship"
    echo "  as release $APP_RELEASE without being part of it:"
    echo "$DIRTY" | sed 's/^/    /'
    echo "  Commit or stash them, or re-run as: ALLOW_DIRTY=1 ./deploy.sh"
    exit 1
  fi
fi

# Uploads live outside the deploy root (see lib/uploadRoot). If UPLOAD_DIR is
# missing from the server's .env, the app silently falls back to
# <repo>/uploads: every image 404s, and new uploads land inside the rsync
# --delete path where the NEXT deploy erases them. Neither failure is visible
# until someone reports a broken avatar, so check before we ship anything.
echo "→ Checking upload store..."
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s <<'CHECK_UPLOADS' || { echo "✗ Refusing to deploy — fix UPLOAD_DIR on the server first."; exit 1; }
set -e
cd /root/smileys-community
DIR=$(grep -m1 '^UPLOAD_DIR=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | xargs || true)
if [ -z "$DIR" ]; then
  echo "  ✗ UPLOAD_DIR is not set in /root/smileys-community/.env"
  exit 1
fi
case "$DIR" in
  /root/smileys-community/*) echo "  ✗ UPLOAD_DIR ($DIR) is inside the deploy root — rsync --delete will wipe it"; exit 1 ;;
esac
[ -d "$DIR" ] || { echo "  ✗ UPLOAD_DIR ($DIR) does not exist on the server"; exit 1; }
echo "  ✓ $DIR ($(find "$DIR" -type f | wc -l | tr -d ' ') files)"
CHECK_UPLOADS

# Schema must lead the code, never trail it. Prisma selects every column in a
# model, so shipping code whose schema.prisma knows about a column the database
# does not have makes EVERY query on that model throw P2022 — not the one new
# feature, the whole table. `events.soldOut` was exactly this on 2026-08-16:
# the code was one deploy away from 500'ing every events query site-wide.
#
# The root cause is `prisma db push`, which syncs the schema but runs none of
# the migration SQL and records nothing in _prisma_migrations. That is how three
# columns appeared in production with no history row and a backfill silently
# skipped — the backfill being the entire point of the migration that owned it.
# Use `prisma migrate deploy`, and let this check hold the line.
#
# Compares the migrations about to ship against what the database says it has
# applied. Advisory-but-loud when the DB is unreachable rather than a hard fail:
# a psql hiccup should not block a deploy that has nothing to do with schema.
echo "→ Checking migrations are applied to prod..."
APPLIED=$(ssh "${SSH_OPTS[@]}" "$SERVER" bash -s <<'CHECK_MIGRATIONS' 2>/dev/null || true
DB=$(grep -m1 '^DATABASE_URL' /root/smileys-community/.env 2>/dev/null | cut -d= -f2- | tr -d '"')
[ -n "$DB" ] || exit 1
psql "$DB" -At -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"
CHECK_MIGRATIONS
)
if [ -z "$APPLIED" ]; then
  echo "  ⚠ Could not read _prisma_migrations — skipping (check the server if this repeats)."
else
  PENDING=""
  for dir in "$LOCAL"/prisma/migrations/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    printf '%s\n' "$APPLIED" | grep -qxF "$name" || PENDING="$PENDING$name"$'\n'
  done
  if [ -n "$PENDING" ]; then
    if [ -n "$ALLOW_PENDING_MIGRATIONS" ]; then
      echo "  ⚠ Shipping with migrations NOT applied (ALLOW_PENDING_MIGRATIONS=1):"
      printf '%s' "$PENDING" | sed 's/^/      /'
    else
      echo "✗ Refusing to deploy: these migrations are not applied to prod."
      printf '%s' "$PENDING" | sed 's/^/      /'
      echo "  Code that reads a missing column throws P2022 on EVERY query for that"
      echo "  model, not just the new feature. Apply them first:"
      echo "    ssh $SERVER 'cd $REMOTE && npx --no-install prisma migrate deploy'"
      echo "  If this deploy genuinely does not depend on them: ALLOW_PENDING_MIGRATIONS=1 ./deploy.sh"
      exit 1
    fi
  else
    echo "  ✓ all $(printf '%s\n' "$APPLIED" | grep -c . ) migrations applied"
  fi
fi

echo "→ Checking for vulnerabilities..."
# Audit gate: block on any high/critical ADVISORY except documented, verified-
# non-applicable exceptions listed in AUDIT_ALLOW (moderate/low never gate).
#
# 2026-07-23 — coordinated Next.js security release; all fixed in 15.5.21, but
# 15.5.21 regressed CSP nonce injection (dropped the nonce from <script> tags,
# so our strict-dynamic CSP would block every script and take the site down).
# We pinned next@15.5.18 and accepted three HIGH advisories, each verified not
# applicable here (no Server Actions; rewrites use static hosts).
#
# 2026-08-18 — moved to next@15.5.23 and the exceptions are gone. The nonce is
# injected again: a built server returned 31 of 31 <script> tags carrying one
# nonce, equal to the CSP header's and freshly rotated per request. Re-check
# that on the next Next bump before assuming it still holds — this regressed
# silently once, and the smoke test is what catches it.
#
# AUDIT_ALLOW stays as the mechanism for a documented, verified-non-applicable
# advisory. It is empty because nothing currently qualifies; do not add an entry
# without writing down what was checked and why it does not apply.
AUDIT_ALLOW=""
npm audit --json --legacy-peer-deps 2>/dev/null | AUDIT_ALLOW="$AUDIT_ALLOW" python3 -c '
import json, os, sys
allow = set(os.environ.get("AUDIT_ALLOW", "").split())
data = json.load(sys.stdin)
blocking = []
for name, info in data.get("vulnerabilities", {}).items():
    for v in info.get("via", []):
        if not isinstance(v, dict) or v.get("severity") not in ("high", "critical"):
            continue
        gh = (v.get("url", "") or "").rstrip("/").split("/")[-1]
        if gh not in allow:
            sev = v.get("severity")
            title = (v.get("title") or "")[:60]
            blocking.append(f"{sev} {name} {gh} {title}")
if blocking:
    print("Blocking high/critical advisories (not allow-listed):")
    for b in blocking: print("  " + b)
    sys.exit(1)
print("Audit OK — allow-listed non-applicable exceptions: " + ", ".join(sorted(allow)))
' || { echo "✗ npm audit found blocking high/critical vulnerabilities — fix before deploying"; exit 1; }

# Preflight: kill any leftover `next dev` server (or whatever holds :3000).
# On this low-memory box a running dev server starves the build's worker
# processes — a worker gets OOM-killed mid "Collecting page data" and the
# build dies with a *random* `PageNotFoundError: Cannot find module for page:
# /<page>` (different page each run — that's the tell, not a code bug). It also
# squats the port the smoke test needs. Clearing it here makes deploys
# deterministic. Loud on purpose: if you were using that dev server, restart
# it with `npm run dev` once the deploy finishes. The `| sort -u` keeps the
# command-substitution exit status 0 so `set -e` doesn't trip when nothing's
# found (pgrep/lsof exit 1 on no match).
DEV_PIDS=$( { pgrep -f 'next dev' 2>/dev/null; lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null; } | sort -u )
if [ -n "$DEV_PIDS" ]; then
  echo "⚠ Found a local dev server / :3000 listener (PIDs: $(echo $DEV_PIDS)) — killing it so the build can't OOM..."
  kill $DEV_PIDS 2>/dev/null || true
  sleep 2
  STILL=$( { pgrep -f 'next dev' 2>/dev/null; lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null; } | sort -u )
  [ -n "$STILL" ] && { kill -9 $STILL 2>/dev/null || true; sleep 1; }
  echo "  ✓ Cleared. Restart your dev server with 'npm run dev' after the deploy if you need it."
fi

if [ -z "$SKIP_BUILD" ]; then
  echo "→ Building locally (release: $APP_RELEASE)..."
  # Preserve .next/cache (webpack incremental cache) — nuking it forces a full
  # cold build every deploy and causes OOM kills on low-memory machines.
  find "$LOCAL/.next" -mindepth 1 -maxdepth 1 ! -name 'cache' -exec rm -rf {} + 2>/dev/null || true
  # PostHog sourcemap upload (see next.config.js) is opt-in via
  # UPLOAD_SOURCEMAPS=1 — it costs ~52s and only matters if you're about to
  # debug a production JS error. Skipped by default: `UPLOAD_SOURCEMAPS=1
  # ./deploy.sh` to include it for a release you expect to need that for.
  # Raise the build worker's heap. Node defaults to ~2.2GB on this 8GB machine,
  # and "Collecting build traces" runs out on a project this size — the worker
  # dies with SIGTERM, or leaves a half-written .next and the build fails with a
  # baffling `ENOENT ... pages-manifest.json` / `page.js.nft.json`. Neither
  # message says "out of memory", so this reads as random flakiness and gets
  # retried instead of fixed (it cost several deploy attempts on 2026-08-15).
  # Respects an existing NODE_OPTIONS rather than clobbering it.
  NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=6144" \
    APP_RELEASE="$APP_RELEASE" npm run build
else
  echo "→ Skipping build (SKIP_BUILD set, using existing .next)..."
fi

# Pre-deploy smoke: start the built server locally and hit the key paths so a
# broken build (missing chunks, runtime errors, etc.) is caught before we stop
# prod. Exits non-zero on failure, which set -e propagates.
echo "→ Running smoke test..."
"$LOCAL/scripts/smoke.sh" "$LOCAL"

echo "→ Syncing files (server still serving)..."
# Leave pm2 running through the rsync. Next.js loads chunks at process
# start, so in-flight requests are unaffected by files changing under
# them. We only restart once everything is in place — cuts deploy
# downtime from ~45s of 502s to a single ~5s pm2 restart window.
rsync -av --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.next/cache/' \
  --exclude='.env.production' \
  --exclude='*.map' \
  --exclude='backups/' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.claude/' \
  --exclude='public/uploads' \
  --exclude='uploads/' \
  --exclude='data/announcement.json' \
  --exclude='data/member-spotlight.json' \
  --exclude='data/settings.json' \
  --exclude='data/neighborhoods/' \
  --exclude='data/banner.json' \
  --exclude='data/banners.json' \
  --exclude='data/why-content.json' \
  --exclude='data/content.json' \
  --exclude='data/city-guide.json' \
  --exclude='data/handbook-heroes.json' \
  "$LOCAL/" "$SERVER:$REMOTE/" || { CODE=$?; [ "$CODE" = "23" ] || [ "$CODE" = "24" ] || exit $CODE; }

# Stamp the service-worker cache key with this release, ON THE SERVER after
# rsync. Without this, deploys that forget a manual bump leave returning PWA
# visitors on a cached app shell referencing chunk hashes the deploy just
# deleted — the site "never loads" for exactly the people who use it most
# (took the site down for returning visitors on 2026-08-02 after ~8 unbumped
# deploys). Stamping server-side keeps the local file (and git) untouched;
# the literal version in public/sw.js now only matters for local dev.
echo "→ Stamping SW cache key (smileys-$APP_RELEASE)..."
ssh "${SSH_OPTS[@]}" "$SERVER" "sed -i \"s/const CACHE = 'smileys-[^']*'/const CACHE = 'smileys-$APP_RELEASE'/\" $REMOTE/public/sw.js && grep -o \"smileys-[a-z0-9]*'\" $REMOTE/public/sw.js | head -1"

echo "→ Restarting server (graceful)..."
# Restart instead of stop+start so the gap between old and new
# processes is just pm2's drain window. Falls back to start if
# smileys isn't registered yet (first-time deploy on a new host).
#
# `prisma db push` is deliberately NOT chained into the restart with &&.
# It refuses destructive changes (dropping a column that still holds data)
# and exits 1 — and chained, that exit skipped the restart entirely, leaving
# the old process serving against a .next the rsync had already replaced.
# SSR routes still answer 200 in that state, so nothing looks wrong, while
# returning visitors request chunk hashes that no longer exist on disk
# (2026-08-10: the site sat like that until the restart was run by hand).
# The restart is the step that must not be skipped, so the push runs on its
# own and only records its status; we report the failure loudly below and
# still exit non-zero, but the site ends up on the code we just shipped.
# Exit 90 is the agreed marker for "schema push failed, everything else ok".
SCHEMA_PUSH_FAILED=0
RESTART_RC=0
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s <<REMOTE_RESTART || RESTART_RC=$?
set -e
cd $REMOTE
npm install --legacy-peer-deps
npx prisma generate --schema=./prisma/schema.prisma
DB_PUSH_RC=0
npx prisma db push --schema=./prisma/schema.prisma || DB_PUSH_RC=90
pm2 restart smileys --update-env || pm2 start smileys --max-memory-restart 512M
pm2 save
exit \$DB_PUSH_RC
REMOTE_RESTART

if [ "$RESTART_RC" = "90" ]; then
  SCHEMA_PUSH_FAILED=1
  echo "⚠ prisma db push FAILED — the app restarted on the new code, but the"
  echo "  database schema was NOT updated. If the push was refused over data"
  echo "  loss, decide whether to keep the column (add it back to schema.prisma)"
  echo "  or drop it (npx prisma db push --accept-data-loss on the server)."
  echo "  Until it's resolved, every deploy will report this same failure."
elif [ "$RESTART_RC" != "0" ]; then
  echo "✗ Restart step failed (exit $RESTART_RC) — the server may still be on the old build."
  exit "$RESTART_RC"
fi

# All sweeper crontabs registered in ONE ssh session instead of 14 separate
# connections (each paying its own SSH handshake — a real chunk of deploy
# wall-clock time for a script that's otherwise just local reads/writes).
# Each block is still its own independent, idempotent read-modify-write of
# the crontab (grep -v strips any existing line for that sweeper, then
# appends the fresh one) — same sequential semantics as the old per-call
# version, just one transport instead of many. `set -e` inside the heredoc
# preserves the original behavior where a failure aborts everything after it.
#
# Install the Hangouts sweeper cron (idempotent — strips any existing
# sweep-hangouts line first, then adds a fresh one). Without this, expired
# hangouts never get a recap and "starting soon" pushes never fire. The
# script itself is fail-soft if CRON_SECRET isn't configured yet.
#
# Install the post-event survey dispatch cron. Hourly — events end on
# variable schedules and we only need to land in the 24h-7d window
# once per event. Idempotent in the same way as the hangouts cron
# above: existing line is stripped before the fresh one lands.
#
# Install the quarterly NPS dispatch cron. Daily — the sweeper itself
# is a no-op outside the first 14 days of each quarter, so the cost
# of a daily ping is negligible. Daily cadence (vs. weekly) lets
# latecomers whose joinedAt crosses the 30d eligibility threshold
# mid-window still get nudged in their first eligible quarter.
#
# Install the cup match-reminder cron — fires every 5 minutes during
# the tournament window and is a no-op otherwise (the sweeper's query
# returns zero rows when no fixture is in the [T-35, T-25] window).
# 5-min cadence is the precision we need to land in the T-30 window
# exactly once per fixture; tighter would burn idle CPU, looser would
# miss fixtures.
# DISABLED 2026-07-27 — Smileys Cup 2026 is over, so we no longer register the
# two 5-min cup sweepers (they were dead work every 5 minutes). Instead each
# deploy actively STRIPS them, so a stale crontab can't keep them alive. To run
# the next tournament, restore the two register blocks (kept below, commented)
# and remove the strip line.
# chmod +x $REMOTE/scripts/sweep-cup-reminders.sh
# (crontab -l 2>/dev/null | grep -v 'sweep-cup-reminders' ; echo '*/5 * * * * $REMOTE/scripts/sweep-cup-reminders.sh >> /var/log/sweep-cup-reminders.log 2>&1') | crontab -
# chmod +x $REMOTE/scripts/sweep-cup-results.sh
# (crontab -l 2>/dev/null | grep -v 'sweep-cup-results' ; echo '*/5 * * * * $REMOTE/scripts/sweep-cup-results.sh >> /var/log/sweep-cup-results.log 2>&1') | crontab -
#
# Newsletter sweeper — every 5 min.
#
# First-RSVP nudge — Wed 12:00 Istanbul = 09:00 UTC.
#
# Nightly cleanup of expired AvailabilityPulse rows. Runs at 3 AM Istanbul
# time (UTC+3 = 00:00 UTC). Without this stale pulses accumulate forever.
#
# Daily nudge for approved members who never logged in. 10 AM Istanbul (07:00 UTC).
#
# Weekly neighborhood-hygiene scan — Mondays 06:20 UTC, 20 min after the
# connection-abuse scan so two tsx processes don't start together. Read-only:
# it emails ADMIN_EMAIL a report of member neighborhoods that don't match their
# city's registry. Unlike names there is no auto-fix in the cron — two of the
# four write paths coerce a bad value to NULL rather than reject it (a bad
# district must never block an approved registration), so that loss is silent
# by design and this is what surfaces it. Fix with scripts/fix-member-neighborhoods.ts.
#
# Nightly name-hygiene sweep — re-cases member names (ALL-CAPS + lowercase
# first letters) using each member's nationality for the Turkish-i rules.
# 03:20 UTC (06:20 Istanbul), after the DB backup.
#
# Daily expired-waitlist sweep — warm "that one filled up" close-out to
# members whose queued event passed without a spot opening, then purges
# the stale entries. 20 6 UTC (09:20 Istanbul) so the note lands at a
# friendly morning hour, not overnight.
#
# Nightly spotsLeft reconciliation for upcoming events — re-derives the
# cached counter from approved attendee rows so drift from bulk
# attendee-row deletion (account deletion, admin user removal) can't
# leave phantom "going" counts. 03:35 UTC, after name-hygiene.
#
# Weekly directory-review nudge — one in-app notification to members who
# checked in at a directory venue but never reviewed it (most-visited
# venue only, idempotent per member). Wed 09:40 UTC (12:40 Istanbul) —
# off the Monday digest, midday so a web-push lands at a friendly hour.
#
# Hourly payment-reminder sweep — one nudge to unpaid attendees of
# Smileys-collected events starting within 48h (reminderSentAt stamp
# guarantees one-and-only-one). Runs at :40 so it never overlaps the
# 5-min cup sweepers' load spikes.
#
# Daily DB backup — 02:00 UTC (05:00 Istanbul), low-traffic window. Dumps to
# /root/db-backups (outside the repo so rsync --delete can't wipe it), keeps 14.
echo "→ Registering sweeper crontabs..."
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s <<EOF
set -e
chmod +x $REMOTE/scripts/sweep-hangouts.sh
(crontab -l 2>/dev/null | grep -v 'sweep-hangouts' ; echo '*/15 * * * * $REMOTE/scripts/sweep-hangouts.sh >> /var/log/sweep-hangouts.log 2>&1') | crontab -
echo '  ✓ hangouts'

chmod +x $REMOTE/scripts/sweep-event-surveys.sh
(crontab -l 2>/dev/null | grep -v 'sweep-event-surveys' ; echo '5 * * * * $REMOTE/scripts/sweep-event-surveys.sh >> /var/log/sweep-event-surveys.log 2>&1') | crontab -
echo '  ✓ event-surveys'

chmod +x $REMOTE/scripts/sweep-nps-dispatch.sh
(crontab -l 2>/dev/null | grep -v 'sweep-nps-dispatch' ; echo '10 9 * * * $REMOTE/scripts/sweep-nps-dispatch.sh >> /var/log/sweep-nps.log 2>&1') | crontab -
echo '  ✓ nps-dispatch'

crontab -l 2>/dev/null | grep -v 'sweep-cup-reminders' | grep -v 'sweep-cup-results' | crontab -
echo '  ✓ cup sweepers stripped'

chmod +x $REMOTE/scripts/sweep-newsletters.sh
(crontab -l 2>/dev/null | grep -v 'sweep-newsletters' ; echo '*/5 * * * * $REMOTE/scripts/sweep-newsletters.sh >> /var/log/sweep-newsletters.log 2>&1') | crontab -
echo '  ✓ newsletters'

chmod +x $REMOTE/scripts/sweep-first-rsvp-nudge.sh
(crontab -l 2>/dev/null | grep -v 'sweep-first-rsvp-nudge' ; echo '0 9 * * 3 $REMOTE/scripts/sweep-first-rsvp-nudge.sh >> /var/log/sweep-first-rsvp-nudge.log 2>&1') | crontab -
echo '  ✓ first-rsvp-nudge'

chmod +x $REMOTE/scripts/sweep-availability-pulses.sh
(crontab -l 2>/dev/null | grep -v 'sweep-availability-pulses' ; echo '0 0 * * * $REMOTE/scripts/sweep-availability-pulses.sh >> /var/log/sweep-availability-pulses.log 2>&1') | crontab -
echo '  ✓ availability-pulses'

chmod +x $REMOTE/scripts/sweep-login-nudge.sh
(crontab -l 2>/dev/null | grep -v 'sweep-login-nudge' ; echo '0 7 * * * $REMOTE/scripts/sweep-login-nudge.sh >> /var/log/sweep-login-nudge.log 2>&1') | crontab -
echo '  ✓ login-nudge'

chmod +x $REMOTE/scripts/sweep-name-hygiene.sh
(crontab -l 2>/dev/null | grep -v 'sweep-name-hygiene' ; echo '20 3 * * * $REMOTE/scripts/sweep-name-hygiene.sh >> /var/log/sweep-name-hygiene.log 2>&1') | crontab -
echo '  ✓ name-hygiene'

chmod +x $REMOTE/scripts/sweep-neighborhood-hygiene.sh
(crontab -l 2>/dev/null | grep -v 'sweep-neighborhood-hygiene' ; echo '20 6 * * 1 $REMOTE/scripts/sweep-neighborhood-hygiene.sh >> /var/log/sweep-neighborhood-hygiene.log 2>&1') | crontab -
echo '  ✓ neighborhood-hygiene'

chmod +x $REMOTE/scripts/sweep-waitlists.sh
(crontab -l 2>/dev/null | grep -v 'sweep-waitlists' ; echo '20 6 * * * $REMOTE/scripts/sweep-waitlists.sh >> /var/log/sweep-waitlists.log 2>&1') | crontab -
echo '  ✓ waitlists'

chmod +x $REMOTE/scripts/sweep-event-spots.sh
(crontab -l 2>/dev/null | grep -v 'sweep-event-spots' ; echo '35 3 * * * $REMOTE/scripts/sweep-event-spots.sh >> /var/log/sweep-event-spots.log 2>&1') | crontab -
echo '  ✓ event-spots'

chmod +x $REMOTE/scripts/sweep-review-nudges.sh
(crontab -l 2>/dev/null | grep -v 'sweep-review-nudges' ; echo '40 9 * * 3 $REMOTE/scripts/sweep-review-nudges.sh >> /var/log/sweep-review-nudges.log 2>&1') | crontab -
echo '  ✓ review-nudges'

chmod +x $REMOTE/scripts/sweep-payment-reminders.sh
(crontab -l 2>/dev/null | grep -v 'sweep-payment-reminders' ; echo '40 * * * * $REMOTE/scripts/sweep-payment-reminders.sh >> /var/log/sweep-payment-reminders.log 2>&1') | crontab -
echo '  ✓ payment-reminders'

chmod +x $REMOTE/scripts/db-backup.sh
(crontab -l 2>/dev/null | grep -v 'db-backup' ; echo '0 2 * * * $REMOTE/scripts/db-backup.sh >> /var/log/db-backup.log 2>&1') | crontab -
echo '  ✓ db-backup'
EOF

# DISABLED 2026-07-27 — Smileys Cup 2026 is over. The fixtures are already
# seeded and correct in the DB (these steps were idempotent no-ops on every
# deploy), so we stop re-running them. Re-enable for the next tournament by
# uncommenting (and updating the season data in the scripts).
# echo "→ Seeding Smileys Cup 2026 fixtures..."
# ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE && npx tsx --env-file=.env scripts/seed-cup.ts"
# echo "→ Overlaying real FIFA schedule on group fixtures..."
# ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE && npx tsx --env-file=.env scripts/fix-group-fixtures.ts"

# Warm the OG image route. /api/og pulls in the satori/resvg render stack
# and its fonts on first invocation, which costs ~19s cold — long enough that
# a Facebook/WhatsApp crawler scraping a shared link in the minutes right
# after a restart times out and renders the preview with no image (and then
# caches that miss). One throwaway request pays that cost for us instead.
# Best-effort: never fail the deploy over a warmup.
echo "→ Warming OG image route..."
ssh "${SSH_OPTS[@]}" "$SERVER" "curl -s -o /dev/null -m 60 -w '  og warm: HTTP %{http_code} in %{time_total}s\n' 'http://localhost:3000/app/api/og?title=warmup' || echo '  (og warmup skipped)'"

if [ "$SCHEMA_PUSH_FAILED" = "1" ]; then
  echo "✗ Deployed (release: $APP_RELEASE) but the DB schema is out of sync — see the prisma db push warning above."
  exit 1
fi

echo "✓ Done (release: $APP_RELEASE)"
