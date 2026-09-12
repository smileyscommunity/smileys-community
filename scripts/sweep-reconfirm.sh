#!/bin/bash
# Cron-driven sweeper that sends day-before "still coming?" asks and releases unanswered seats (see
# app/api/cron/sweep-reconfirm/route.ts). Runs hourly from system
# crontab on the prod box. Mirrors sweep-hangouts.sh in shape so the
# two scripts can be maintained together.

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
# flock(1) is util-linux; without it the non-blocking lock below would fail
# as "previous run still active" on every tick and the sweep would never run.
command -v flock >/dev/null || { echo "flock missing" >&2; exit 1; }
exec 9>"/tmp/sweep-reconfirm.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

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

# Still fail-soft (exit 0, no crontab mail) — but a non-2xx is written to
# the log with its body. Before, `|| true` hid a rotated CRON_SECRET (403), an
# unset one (503) and a crashed sweep (500) as ordinary quiet runs.
# On a connection failure curl has already written 000 for %{http_code}, so
# the fallback REPLACES the capture (`|| CODE=000`) — echoing a fallback 000
# inside it appended a second one and logged "HTTP 000000".
# A 2xx appends a one-line summary of the response body: the body itself goes
# to $OUT, which the next run overwrites, so the log is the only run history.
OUT="/tmp/sweep-reconfirm.out"
CODE=$(curl -s -S --max-time 60 -o "$OUT" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT") || CODE=000
if [ "$CODE" -lt 200 ] || [ "$CODE" -ge 300 ]; then
  echo "$(date -u +%FT%TZ) FAILED HTTP $CODE: $(head -c 300 "$OUT" 2>/dev/null)"
else
  echo "$(date -u +%FT%TZ) OK HTTP $CODE: $(tr -s '\r\n\t' '   ' < "$OUT" 2>/dev/null | head -c 300)"
fi
