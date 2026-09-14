#!/bin/bash
# Cron-driven nightly prune of duplicate event_recommendations rows
# (see app/api/cron/sweep-recommendation-dupes/route.ts). Registered by deploy.sh.
#
# Reads CRON_SECRET from .env at runtime (never a literal in crontab) and posts
# to the local endpoint. Silently no-ops if the secret isn't configured.
#
# Counts / dry run by hand: scripts/prune-duplicate-recommendations.ts

set -euo pipefail

# One run at a time.
command -v flock >/dev/null || { echo "flock missing" >&2; exit 1; }
exec 9>"/tmp/sweep-recommendation-dupes.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
ENDPOINT="${SMILEYS_SWEEP_ENDPOINT:-http://localhost:3000/app/api/cron/sweep-recommendation-dupes}"

if [ ! -f "$ENV_FILE" ]; then
  exit 0
fi

SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//')

if [ -z "$SECRET" ]; then
  exit 0
fi

# middleware.ts requires a matching Origin on mutating API calls.
ORIGIN=$(echo "$ENDPOINT" | awk -F/ '{print $1"//"$3}')

# The route time-boxes itself at 45s; --max-time leaves room for the batch in flight.
# Fail-soft (exit 0), but a non-2xx is logged with its body.
OUT="/tmp/sweep-recommendation-dupes.out"
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
