#!/bin/bash
# Cron-driven sweeper for member name hygiene (see
# app/api/cron/sweep-name-hygiene/route.ts). Designed to run nightly
# from system crontab on the prod box.
#
# Reads CRON_SECRET from .env (single source of truth — same file Next.js
# loads) and posts to the local sweeper endpoint. Silently no-ops if the
# secret isn't configured so a fresh box doesn't spam stderr.

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
exec 9>"/tmp/sweep-name-hygiene.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-name-hygiene}"

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
OUT="/tmp/sweep-name-hygiene.out"
CODE=$(curl -s -S --max-time 60 -o "$OUT" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || echo 000)
if [ "$CODE" -lt 200 ] || [ "$CODE" -ge 300 ]; then
  echo "$(date -u +%FT%TZ) FAILED HTTP $CODE: $(head -c 300 "$OUT" 2>/dev/null)"
fi
