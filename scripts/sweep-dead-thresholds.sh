#!/bin/bash
# Cron-driven weekly threshold-reachability scan (scripts/scan-dead-thresholds.ts).
# Read-only, like the connection-abuse scan: runs the tsx script directly
# rather than an HTTP endpoint, and emails ADMIN_EMAIL only when something is
# unreachable — a weekly "all clear" is how a report stops being read.
#
# Crontab (Mondays 06:40 UTC = 09:40 Istanbul), 20 min after the
# neighborhood-hygiene scan so no two tsx processes start together:
#   40 6 * * 1 /root/smileys-community/scripts/sweep-dead-thresholds.sh >> /var/log/sweep-dead-thresholds.log 2>&1

set -euo pipefail

# One run at a time — a slow scan must not be overlapped by the next tick.
command -v flock >/dev/null || { echo "flock missing" >&2; exit 1; }
exec 9>"/tmp/sweep-dead-thresholds.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

APP_DIR="${SMILEYS_APP_DIR:-/root/smileys-community}"
cd "$APP_DIR"

# .env has DATABASE_URL; .env.local has RESEND_API_KEY / EMAIL_FROM / ADMIN_EMAIL.
EMAIL_REPORT=1 npx tsx --env-file=.env --env-file=.env.local scripts/scan-dead-thresholds.ts
