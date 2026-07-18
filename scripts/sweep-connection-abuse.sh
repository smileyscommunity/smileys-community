#!/bin/bash
# Cron-driven weekly connection-abuse scan (see scripts/scan-connection-abuse.ts).
# Unlike the other sweepers this one isn't an HTTP endpoint — the scan is a
# read-only report, so it runs the tsx script directly and emails the output
# to ADMIN_EMAIL (EMAIL_REPORT=1 path inside the script).
#
# Crontab (Mondays 06:00 UTC = 09:00 Istanbul):
#   0 6 * * 1 /root/smileys-community/scripts/sweep-connection-abuse.sh >> /var/log/sweep-connection-abuse.log 2>&1

set -euo pipefail

APP_DIR="${SMILEYS_APP_DIR:-/root/smileys-community}"
cd "$APP_DIR"

# .env has DATABASE_URL; .env.local has RESEND_API_KEY / EMAIL_FROM / ADMIN_EMAIL.
EMAIL_REPORT=1 npx tsx --env-file=.env --env-file=.env.local scripts/scan-connection-abuse.ts
