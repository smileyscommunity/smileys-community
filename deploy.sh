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
SENTRY_RELEASE="$SENTRY_RELEASE" npm run build

echo "→ Stopping server..."
ssh "$SERVER" "pm2 stop smileys || true"

echo "→ Syncing files..."
rsync -av --delete \
  --exclude='.env' \
  --exclude='.env.local' \
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
  "$LOCAL/" "$SERVER:$REMOTE/" || { CODE=$?; [ "$CODE" = "23" ] || [ "$CODE" = "24" ] || exit $CODE; }

echo "→ Starting server..."
ssh "$SERVER" "cd $REMOTE && npm install --legacy-peer-deps && npx prisma generate --schema=./prisma/schema.prisma && npx prisma db push --schema=./prisma/schema.prisma && pm2 start smileys --max-memory-restart 512M && pm2 save"

echo "✓ Done (release: $SENTRY_RELEASE)"
