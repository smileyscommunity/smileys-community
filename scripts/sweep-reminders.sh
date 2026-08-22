#!/bin/bash
# Cron-driven sweeper for the hourly reminders dispatch (see
# app/api/admin/cron/reminders/route.ts). Designed to run hourly
# from system crontab on the prod box.
#
# Reads CRON_SECRET from .env (single source of truth — same file Next.js
# loads) and posts to the local sweeper endpoint. Silently no-ops if the
# secret isn't configured so a fresh box doesn't spam stderr.

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/admin/cron/reminders}"

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
# The reminders route is GET-only and reads x-cron-secret (predates
# lib/cronAuth's Bearer convention). Header, not query string — the secret
# must never land in access logs.
curl -s -S --max-time 60 \
  -H "x-cron-secret: $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || true
