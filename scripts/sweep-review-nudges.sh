#!/bin/bash
# Cron-driven sweeper nudging members to review directory businesses they've
# checked in at (see app/api/cron/sweep-review-nudges/route.ts). Designed to
# run weekly from system crontab on the prod box.
#
# Reads CRON_SECRET from .env (single source of truth — same file Next.js
# loads) and posts to the local sweeper endpoint. Silently no-ops if the
# secret isn't configured so a fresh box doesn't spam stderr.

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
# flock(1) is util-linux; without it the non-blocking lock below would fail
# as "previous run still active" on every tick and the sweep would never run.
command -v flock >/dev/null || { echo "flock missing" >&2; exit 1; }
exec 9>"/tmp/sweep-review-nudges.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-review-nudges}"

if [ ! -f "$ENV_FILE" ]; then
  exit 0
fi

# Pull CRON_SECRET out of .env. Handle both `CRON_SECRET=value` and
# `CRON_SECRET="value"` / `CRON_SECRET='value'` styles.
SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//')

if [ -z "$SECRET" ]; then
  # No secret configured — sweeper is gated server-side, nothing to do.
  exit 0
fi

# middleware.ts requires every mutating API call to carry an Origin that
# matches the request host (CSRF defense). Derive the origin from the
# endpoint URL so this script works in any environment without hardcoding.
ORIGIN=$(echo "$ENDPOINT" | awk -F/ '{print $1"//"$3}')

# -s silent, -S show errors, --max-time so a hung Next.js doesn't pile up
# crontab processes. Fail-soft (|| true) so a transient failure doesn't
# trigger crontab email noise; the sweeper is idempotent so missed runs
# self-heal on the next interval.
# Still fail-soft (exit 0, no crontab mail) — but a non-2xx is written to
# the log with its body. Before, `|| true` hid a rotated CRON_SECRET (403), an
# unset one (503) and a crashed sweep (500) as ordinary quiet runs.
# On a connection failure curl has already written 000 for %{http_code}, so
# the fallback REPLACES the capture (`|| CODE=000`) — echoing a fallback 000
# inside it appended a second one and logged "HTTP 000000".
# A 2xx appends a one-line summary of the response body: the body itself goes
# to $OUT, which the next run overwrites, so the log is the only run history.
OUT="/tmp/sweep-review-nudges.out"
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
