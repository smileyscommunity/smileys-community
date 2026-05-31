#!/bin/bash
set -e

SERVER="${SMILEYS_DEPLOY_SERVER:-root@178.105.37.133}"
REMOTE="/root/smileys-community"
LOCAL="/Users/nate/smileys-community"
SENTRY_RELEASE=$(git rev-parse --short HEAD)

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

echo "→ Building locally (release: $SENTRY_RELEASE)..."
rm -rf "$LOCAL/.next"
SENTRY_RELEASE="$SENTRY_RELEASE" npm run build

# Pre-deploy smoke: start the built server locally and hit the key paths so a
# broken build (missing chunks, runtime errors, etc.) is caught before we stop
# prod. Exits non-zero on failure, which set -e propagates.
echo "→ Running smoke test..."
"$LOCAL/scripts/smoke.sh" "$LOCAL"

echo "→ Stopping server..."
ssh "$SERVER" "pm2 stop smileys || true"

echo "→ Syncing files..."
rsync -av --delete \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.next/cache/' \
  --exclude='.env.production' \
  --exclude='node_modules' \
  --exclude='.git' \
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

echo "→ Starting server..."
ssh "$SERVER" "cd $REMOTE && npm install --legacy-peer-deps && npx prisma generate --schema=./prisma/schema.prisma && npx prisma db push --schema=./prisma/schema.prisma && pm2 start smileys --max-memory-restart 512M && pm2 save"

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

echo "✓ Done (release: $SENTRY_RELEASE)"
