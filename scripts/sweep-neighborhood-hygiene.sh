#!/bin/bash
# Cron-driven weekly neighborhood-hygiene scan (see
# scripts/scan-neighborhood-hygiene.ts). Like the connection-abuse scan and
# unlike the other sweepers this is NOT an HTTP endpoint: the scan is read-only,
# so it runs the tsx script directly and emails the output to ADMIN_EMAIL
# (EMAIL_REPORT=1 path inside the script).
#
# Registered by deploy.sh — Mondays 06:20 UTC (09:20 Istanbul), 20 minutes after
# the connection-abuse scan so two tsx processes don't start at once:
#   20 6 * * 1 /root/smileys-community/scripts/sweep-neighborhood-hygiene.sh >> /var/log/sweep-neighborhood-hygiene.log 2>&1

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
exec 9>"/tmp/sweep-neighborhood-hygiene.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

APP_DIR="${SMILEYS_APP_DIR:-/root/smileys-community}"
cd "$APP_DIR"

# .env has DATABASE_URL; .env.local has RESEND_API_KEY / EMAIL_FROM / ADMIN_EMAIL.
EMAIL_REPORT=1 npx tsx --env-file=.env --env-file=.env.local scripts/scan-neighborhood-hygiene.ts
