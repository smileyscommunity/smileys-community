#!/bin/bash
set -e

SERVER="root@178.105.37.133"
REMOTE="/root/smileys-community"
LOCAL="/Users/nate/smileys-community"

echo "→ Checking for vulnerabilities..."
npm audit --audit-level=high --legacy-peer-deps || { echo "✗ npm audit found high/critical vulnerabilities — fix before deploying"; exit 1; }

echo "→ Building locally..."
npm run build

echo "→ Syncing files..."
rsync -av --checksum --delete \
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

echo "→ Restarting..."
ssh "$SERVER" "cd $REMOTE && rm -rf .next && npm install --legacy-peer-deps && npx prisma generate --schema=./prisma/schema.prisma && npx prisma db push --schema=./prisma/schema.prisma && npm run build && pm2 restart smileys"

echo "✓ Done"
