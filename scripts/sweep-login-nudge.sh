#!/bin/bash
# Daily nudge for approved members who haven't logged in yet.
# See app/api/cron/sweep-login-nudge/route.ts for logic.

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT_BASE:-http://localhost:3000/app}/api/cron/sweep-login-nudge"

if [ ! -f "$ENV_FILE" ]; then exit 0; fi

SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')
if [ -z "$SECRET" ]; then exit 0; fi

ORIGIN=$(echo "$ENDPOINT" | awk -F/ '{print $1"//"$3}')

curl -s -S --max-time 60 \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || true
