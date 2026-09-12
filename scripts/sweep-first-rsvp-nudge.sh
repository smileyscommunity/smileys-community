#!/bin/bash
# Cron-driven weekly first-RSVP nudge. Registered to run Wednesday 09:00 UTC
# (= 12:00 Istanbul). Emails members who joined but never RSVP'd one matched
# first-event suggestion; the endpoint is idempotent (30-day per-member guard).

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
# flock(1) is util-linux; without it the non-blocking lock below would fail
# as "previous run still active" on every tick and the sweep would never run.
command -v flock >/dev/null || { echo "flock missing" >&2; exit 1; }
exec 9>"/tmp/sweep-first-rsvp-nudge.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_NUDGE_ENDPOINT:-http://localhost:3000/app/api/cron/first-rsvp-nudge}"

if [ ! -f "$ENV_FILE" ]; then exit 0; fi

SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//')
if [ -z "$SECRET" ]; then exit 0; fi

ORIGIN=$(echo "$ENDPOINT" | awk -F/ '{print $1"//"$3}')

# Still fail-soft (exit 0, no crontab mail) — but a non-2xx is written to
# the log with its body. Before, `|| true` hid a rotated CRON_SECRET (403), an
# unset one (503) and a crashed sweep (500) as ordinary quiet runs.
# On a connection failure curl has already written 000 for %{http_code}, so
# the fallback REPLACES the capture (`|| CODE=000`) — echoing a fallback 000
# inside it appended a second one and logged "HTTP 000000".
# A 2xx appends a one-line summary of the response body: the body itself goes
# to $OUT, which the next run overwrites, so the log is the only run history.
OUT="/tmp/sweep-first-rsvp-nudge.out"
CODE=$(curl -s -S --max-time 120 -o "$OUT" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT") || CODE=000
if [ "$CODE" -lt 200 ] || [ "$CODE" -ge 300 ]; then
  echo "$(date -u +%FT%TZ) FAILED HTTP $CODE: $(head -c 300 "$OUT" 2>/dev/null)"
else
  echo "$(date -u +%FT%TZ) OK HTTP $CODE: $(tr -s '\r\n\t' '   ' < "$OUT" 2>/dev/null | head -c 300)"
fi
