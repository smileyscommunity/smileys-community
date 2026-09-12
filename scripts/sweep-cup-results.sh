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

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
exec 9>"/tmp/sweep-cup-results.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

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

# Still fail-soft (exit 0, no crontab mail) — but a non-2xx is written to
# the log with its body. Before, `|| true` hid a rotated CRON_SECRET (403), an
# unset one (503) and a crashed sweep (500) as ordinary quiet runs.
OUT="/tmp/sweep-cup-results.out"
CODE=$(curl -s -S --max-time 60 -o "$OUT" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || echo 000)
if [ "$CODE" -lt 200 ] || [ "$CODE" -ge 300 ]; then
  echo "$(date -u +%FT%TZ) FAILED HTTP $CODE: $(head -c 300 "$OUT" 2>/dev/null)"
fi
