#!/bin/bash
# Cron-driven weekly connection-abuse scan (see scripts/scan-connection-abuse.ts).
# Unlike the other sweepers this one isn't an HTTP endpoint — the scan is a
# read-only report, so it runs the tsx script directly and emails the output
# to ADMIN_EMAIL (EMAIL_REPORT=1 path inside the script).
#
# Crontab (Mondays 06:00 UTC = 09:00 Istanbul):
#   0 6 * * 1 /root/smileys-community/scripts/sweep-connection-abuse.sh >> /var/log/sweep-connection-abuse.log 2>&1

set -euo pipefail

# One run at a time: a slow sweep (a 1k-recipient blast, a busy DB) must not
# be overlapped by the next crontab tick.
exec 9>"/tmp/sweep-connection-abuse.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) skipped: previous run still active"; exit 0; }

APP_DIR="${SMILEYS_APP_DIR:-/root/smileys-community}"
cd "$APP_DIR"

# .env has DATABASE_URL; .env.local has RESEND_API_KEY / EMAIL_FROM / ADMIN_EMAIL.
EMAIL_REPORT=1 npx tsx --env-file=.env --env-file=.env.local scripts/scan-connection-abuse.ts
