#!/bin/bash
set -e

SERVER="${SMILEYS_DEPLOY_SERVER:-root@178.105.37.133}"
REMOTE="/root/smileys-community"
LOCAL="/Users/nate/smileys-community"
APP_RELEASE=$(git rev-parse --short HEAD)

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

echo "→ Checking for vulnerabilities..."
npm audit --audit-level=high --legacy-peer-deps || { echo "✗ npm audit found high/critical vulnerabilities — fix before deploying"; exit 1; }

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
rsync -av --delete \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.next/cache/' \
  --exclude='.env.production' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.claude/' \
  --exclude='public/uploads' \
  --exclude='data/announcement.json' \
  --exclude='data/member-spotlight.json' \
  --exclude='data/settings.json' \
  --exclude='data/neighborhoods/' \
  --exclude='data/banner.json' \
  --exclude='data/banners.json' \
  --exclude='data/why-content.json' \
  --exclude='data/content.json' \
  --exclude='data/city-guide.json' \
  "$LOCAL/" "$SERVER:$REMOTE/" || { CODE=$?; [ "$CODE" = "23" ] || [ "$CODE" = "24" ] || exit $CODE; }

echo "→ Restarting server (graceful)..."
# Restart instead of stop+start so the gap between old and new
# processes is just pm2's drain window. Falls back to start if
# smileys isn't registered yet (first-time deploy on a new host).
ssh "$SERVER" "cd $REMOTE && npm install --legacy-peer-deps && npx prisma generate --schema=./prisma/schema.prisma && npx prisma db push --schema=./prisma/schema.prisma && (pm2 restart smileys --update-env || pm2 start smileys --max-memory-restart 512M) && pm2 save"

# Install the Hangouts sweeper cron (idempotent — strips any existing
# sweep-hangouts line first, then adds a fresh one). Without this, expired
# hangouts never get a recap and "starting soon" pushes never fire. The
# script itself is fail-soft if CRON_SECRET isn't configured yet.
echo "→ Registering hangouts sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-hangouts.sh && (crontab -l 2>/dev/null | grep -v 'sweep-hangouts' ; echo '*/15 * * * * $REMOTE/scripts/sweep-hangouts.sh >> /var/log/sweep-hangouts.log 2>&1') | crontab -"

# Install the post-event survey dispatch cron. Hourly — events end on
# variable schedules and we only need to land in the 24h-7d window
# once per event. Idempotent in the same way as the hangouts cron
# above: existing line is stripped before the fresh one lands.
echo "→ Registering event-survey sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-event-surveys.sh && (crontab -l 2>/dev/null | grep -v 'sweep-event-surveys' ; echo '5 * * * * $REMOTE/scripts/sweep-event-surveys.sh >> /var/log/sweep-event-surveys.log 2>&1') | crontab -"

# Install the quarterly NPS dispatch cron. Daily — the sweeper itself
# is a no-op outside the first 14 days of each quarter, so the cost
# of a daily ping is negligible. Daily cadence (vs. weekly) lets
# latecomers whose joinedAt crosses the 30d eligibility threshold
# mid-window still get nudged in their first eligible quarter.
echo "→ Registering NPS sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-nps-dispatch.sh && (crontab -l 2>/dev/null | grep -v 'sweep-nps-dispatch' ; echo '10 9 * * * $REMOTE/scripts/sweep-nps-dispatch.sh >> /var/log/sweep-nps.log 2>&1') | crontab -"

# Install the cup match-reminder cron — fires every 5 minutes during
# the tournament window and is a no-op otherwise (the sweeper's query
# returns zero rows when no fixture is in the [T-35, T-25] window).
# 5-min cadence is the precision we need to land in the T-30 window
# exactly once per fixture; tighter would burn idle CPU, looser would
# miss fixtures.
echo "→ Registering cup-reminders sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-cup-reminders.sh && (crontab -l 2>/dev/null | grep -v 'sweep-cup-reminders' ; echo '*/5 * * * * $REMOTE/scripts/sweep-cup-reminders.sh >> /var/log/sweep-cup-reminders.log 2>&1') | crontab -"

# Install the cup auto-score sweeper — pulls football-data.org and
# writes per-fixture suggestions for admin to one-click apply.
# 5-min cadence keeps the result lag in single-digit minutes during
# match days; an off-day tick is one cheap API call with zero DB
# writes. Idempotent (sweeper grep strips any prior line first).
echo "→ Registering cup-results sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-cup-results.sh && (crontab -l 2>/dev/null | grep -v 'sweep-cup-results' ; echo '*/5 * * * * $REMOTE/scripts/sweep-cup-results.sh >> /var/log/sweep-cup-results.log 2>&1') | crontab -"

# Seed the Smileys Cup 2026 fixtures (knockouts + group stage).
# Idempotent — per-fixture findUnique guards mean re-runs are safe.
# `--env-file=.env` is required so tsx loads DATABASE_URL (PM2's
# env doesn't bleed into ad-hoc node invocations). Fails loudly if
# anything goes wrong — silent failures here turned a previous
# deploy into "page renders empty bracket and nobody knows why".
echo "→ Registering newsletter sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-newsletters.sh && (crontab -l 2>/dev/null | grep -v 'sweep-newsletters' ; echo '*/5 * * * * $REMOTE/scripts/sweep-newsletters.sh >> /var/log/sweep-newsletters.log 2>&1') | crontab -"

# Nightly cleanup of expired AvailabilityPulse rows. Runs at 3 AM Istanbul
# time (UTC+3 = 00:00 UTC). Without this stale pulses accumulate forever.
echo "→ Registering availability-pulses sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-availability-pulses.sh && (crontab -l 2>/dev/null | grep -v 'sweep-availability-pulses' ; echo '0 0 * * * $REMOTE/scripts/sweep-availability-pulses.sh >> /var/log/sweep-availability-pulses.log 2>&1') | crontab -"

# Daily nudge for approved members who never logged in. 10 AM Istanbul (07:00 UTC).
echo "→ Registering login-nudge sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-login-nudge.sh && (crontab -l 2>/dev/null | grep -v 'sweep-login-nudge' ; echo '0 7 * * * $REMOTE/scripts/sweep-login-nudge.sh >> /var/log/sweep-login-nudge.log 2>&1') | crontab -"

# Nightly name-hygiene sweep — re-cases member names (ALL-CAPS + lowercase
# first letters) using each member's nationality for the Turkish-i rules.
# 03:20 UTC (06:20 Istanbul), after the DB backup.
echo "→ Registering name-hygiene sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-name-hygiene.sh && (crontab -l 2>/dev/null | grep -v 'sweep-name-hygiene' ; echo '20 3 * * * $REMOTE/scripts/sweep-name-hygiene.sh >> /var/log/sweep-name-hygiene.log 2>&1') | crontab -"

# Daily expired-waitlist sweep — warm "that one filled up" close-out to
# members whose queued event passed without a spot opening, then purges
# the stale entries. 20 6 UTC (09:20 Istanbul) so the note lands at a
# friendly morning hour, not overnight.
echo "→ Registering waitlists sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-waitlists.sh && (crontab -l 2>/dev/null | grep -v 'sweep-waitlists' ; echo '20 6 * * * $REMOTE/scripts/sweep-waitlists.sh >> /var/log/sweep-waitlists.log 2>&1') | crontab -"

# Nightly spotsLeft reconciliation for upcoming events — re-derives the
# cached counter from approved attendee rows so drift from bulk
# attendee-row deletion (account deletion, admin user removal) can't
# leave phantom "going" counts. 03:35 UTC, after name-hygiene.
echo "→ Registering event-spots sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-event-spots.sh && (crontab -l 2>/dev/null | grep -v 'sweep-event-spots' ; echo '35 3 * * * $REMOTE/scripts/sweep-event-spots.sh >> /var/log/sweep-event-spots.log 2>&1') | crontab -"

# Weekly directory-review nudge — one in-app notification to members who
# checked in at a directory venue but never reviewed it (most-visited
# venue only, idempotent per member). Wed 09:40 UTC (12:40 Istanbul) —
# off the Monday digest, midday so a web-push lands at a friendly hour.
echo "→ Registering review-nudges sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-review-nudges.sh && (crontab -l 2>/dev/null | grep -v 'sweep-review-nudges' ; echo '40 9 * * 3 $REMOTE/scripts/sweep-review-nudges.sh >> /var/log/sweep-review-nudges.log 2>&1') | crontab -"

# Hourly payment-reminder sweep — one nudge to unpaid attendees of
# Smileys-collected events starting within 48h (reminderSentAt stamp
# guarantees one-and-only-one). Runs at :40 so it never overlaps the
# 5-min cup sweepers' load spikes.
echo "→ Registering payment-reminders sweeper crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/sweep-payment-reminders.sh && (crontab -l 2>/dev/null | grep -v 'sweep-payment-reminders' ; echo '40 * * * * $REMOTE/scripts/sweep-payment-reminders.sh >> /var/log/sweep-payment-reminders.log 2>&1') | crontab -"

# Daily DB backup — 02:00 UTC (05:00 Istanbul), low-traffic window. Dumps to
# /root/db-backups (outside the repo so rsync --delete can't wipe it), keeps 14.
echo "→ Registering daily DB backup crontab..."
ssh "$SERVER" "chmod +x $REMOTE/scripts/db-backup.sh && (crontab -l 2>/dev/null | grep -v 'db-backup' ; echo '0 2 * * * $REMOTE/scripts/db-backup.sh >> /var/log/db-backup.log 2>&1') | crontab -"

echo "→ Seeding Smileys Cup 2026 fixtures..."
ssh "$SERVER" "cd $REMOTE && npx tsx --env-file=.env scripts/seed-cup.ts"

# Overlay the real FIFA schedule onto the 72 group fixtures. The
# seed creates placeholder pairings (uniform MD rotation) and
# synthetic times; this script rewrites them with the verified
# Dec 6 2025 schedule. Idempotent — runs against an already-
# corrected DB produce no-op updates (compares teams + time +
# venue before writing).
echo "→ Overlaying real FIFA schedule on group fixtures..."
ssh "$SERVER" "cd $REMOTE && npx tsx --env-file=.env scripts/fix-group-fixtures.ts"

echo "✓ Done (release: $APP_RELEASE)"
