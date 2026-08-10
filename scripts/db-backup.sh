#!/bin/bash
# Daily server-side Postgres backup for Smileys. Dumps smileys_db to
# /root/db-backups (gzipped), keeping the last 14. Runs on the Hetzner
# server via cron (registered in deploy.sh).
#
# Stored OUTSIDE /root/smileys-community on purpose: deploy.sh's
# `rsync -av --delete` would otherwise wipe any server backup not present
# in the local repo's backups/ dir (that's why only one stale dump existed).
set -euo pipefail

BACKUP_DIR="/root/db-backups"
mkdir -p "$BACKUP_DIR"

TS=$(date -u +%Y-%m-%d_%H-%M-%S)
FILE="$BACKUP_DIR/smileys_${TS}.sql.gz"

# Password comes from the server's .env, never from this file — a credential
# committed to the repo is one that can't be rotated without a deploy (and it
# rode along in every clone until 2026-08-10).
ENV_FILE="${SMILEYS_ENV_FILE:-/root/smileys-community/.env}"
PGPASSWORD=$(sed -n 's|.*://smileys:\([^@]*\)@.*|\1|p' "$ENV_FILE" | head -1)
if [ -z "$PGPASSWORD" ]; then
  echo "✗ Could not read the DB password from $ENV_FILE — aborting rather than writing an empty backup" >&2
  exit 1
fi
export PGPASSWORD

pg_dump -U smileys -h localhost smileys_db | gzip > "$FILE"

# Sanity: a real dump gzips to well over 100KB; anything tiny = pg_dump
# silently failed (bad creds, server down), so don't let it evict a good one.
SIZE=$(stat -c%s "$FILE" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 100000 ]; then
  echo "✗ Backup too small (${SIZE} bytes) — removing, keeping prior backups" >&2
  rm -f "$FILE"
  exit 1
fi

# Retention: keep the 14 most recent.
ls -t "$BACKUP_DIR"/smileys_*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "✓ Backup: $FILE ($(du -h "$FILE" | cut -f1)) — $(ls "$BACKUP_DIR"/smileys_*.sql.gz | wc -l) kept"
