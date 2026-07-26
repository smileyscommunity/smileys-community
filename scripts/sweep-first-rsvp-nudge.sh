#!/bin/bash
# Cron-driven weekly first-RSVP nudge. Registered to run Wednesday 09:00 UTC
# (= 12:00 Istanbul). Emails members who joined but never RSVP'd one matched
# first-event suggestion; the endpoint is idempotent (30-day per-member guard).

set -euo pipefail

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_NUDGE_ENDPOINT:-http://localhost:3000/app/api/cron/first-rsvp-nudge}"

if [ ! -f "$ENV_FILE" ]; then exit 0; fi

SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//')
if [ -z "$SECRET" ]; then exit 0; fi

ORIGIN=$(echo "$ENDPOINT" | awk -F/ '{print $1"//"$3}')

curl -s -S --max-time 120 \
  -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Origin: $ORIGIN" \
  "$ENDPOINT" || true
