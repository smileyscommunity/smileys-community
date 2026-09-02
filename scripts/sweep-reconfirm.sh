#!/bin/bash
# Cron-driven sweeper that sends day-before "still coming?" asks and releases unanswered seats (see
# app/api/cron/sweep-reconfirm/route.ts). Runs hourly from system
# crontab on the prod box. Mirrors sweep-hangouts.sh in shape so the
# two scripts can be maintained together.

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_RECONFIRM_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-reconfirm}"

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
