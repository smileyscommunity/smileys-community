#!/bin/bash
# Cron-driven sweeper reconciling Event.spotsLeft with the actual approved
# attendee rows on upcoming events (see
# app/api/cron/sweep-event-spots/route.ts). Designed to run nightly
# from system crontab on the prod box.
#
# Reads CRON_SECRET from .env (single source of truth — same file Next.js
# loads) and posts to the local sweeper endpoint. Silently no-ops if the
# secret isn't configured so a fresh box doesn't spam stderr.

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-event-spots}"

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
curl -s -S --max-time 60 \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || true
