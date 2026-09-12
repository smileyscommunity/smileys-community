#!/bin/bash
# Cron-driven sweeper that nudges eligible members to take the
# quarterly NPS (see app/api/cron/sweep-nps/route.ts). Runs daily
# from the system crontab. The sweeper itself is a no-op outside
# the first 14 days of each quarter, so a daily ping is cheap.
# Mirrors sweep-event-surveys.sh in shape.

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
exec 9>"/tmp/sweep-nps-dispatch.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

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

# Still fail-soft (exit 0, no crontab mail) — but a non-2xx is written to
# the log with its body. Before, `|| true` hid a rotated CRON_SECRET (403), an
# unset one (503) and a crashed sweep (500) as ordinary quiet runs.
OUT="/tmp/sweep-nps-dispatch.out"
CODE=$(curl -s -S --max-time 60 -o "$OUT" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || echo 000)
if [ "$CODE" -lt 200 ] || [ "$CODE" -ge 300 ]; then
  echo "$(date -u +%FT%TZ) FAILED HTTP $CODE: $(head -c 300 "$OUT" 2>/dev/null)"
fi
