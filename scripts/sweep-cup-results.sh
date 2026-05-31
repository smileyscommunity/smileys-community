#!/bin/bash
# Cron-driven sweeper that pulls fresh match results from
# football-data.org and writes per-fixture suggestions (see
# app/api/cron/sweep-cup-results/route.ts). Designed to run every 5
# minutes from system crontab on the prod box during tournament
# windows.
#
# No-op outside the tournament: the API returns an empty match list
# for date ranges with no scheduled matches; the route still issues
# one API call but no DB writes happen. Free tier easily handles
# the off-day cadence.
#
# Reads CRON_SECRET from .env (single source of truth — same file
# Next.js loads) and posts to the local sweeper endpoint. Silently
# no-ops if the secret isn't configured so a fresh box doesn't spam
# stderr.

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-cup-results}"

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
