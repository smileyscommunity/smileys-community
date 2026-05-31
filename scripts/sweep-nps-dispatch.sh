#!/bin/bash
# Cron-driven sweeper that nudges eligible members to take the
# quarterly NPS (see app/api/cron/sweep-nps/route.ts). Runs daily
# from the system crontab. The sweeper itself is a no-op outside
# the first 14 days of each quarter, so a daily ping is cheap.
# Mirrors sweep-event-surveys.sh in shape.

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_NPS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-nps}"

if [ ! -f "$ENV_FILE" ]; then
  exit 0
fi

SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//')

if [ -z "$SECRET" ]; then
  exit 0
fi

ORIGIN=$(echo "$ENDPOINT" | awk -F/ '{print $1"//"$3}')

curl -s -S --max-time 60 \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || true
