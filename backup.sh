#!/bin/bash
set -e

SERVER="${SMILEYS_DEPLOY_SERVER:-root@178.105.37.133}"
BACKUP_DIR="/Users/nate/smileys-community/backups"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILENAME="smileys_backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "→ Dumping production database..."
# The password is read from the server's .env inside the ssh session, so it
# never lives in this file (or in any clone of the repo) and a rotation needs
# no code change here.
ssh "$SERVER" 'PGPASSWORD=$(sed -n "s|.*://smileys:\([^@]*\)@.*|\1|p" /root/smileys-community/.env | head -1); [ -n "$PGPASSWORD" ] || { echo "could not read DB password from server .env" >&2; exit 1; }; export PGPASSWORD; pg_dump -U smileys -h localhost smileys_db' > "$BACKUP_DIR/$FILENAME"

# Sanity check — an empty or tiny file means pg_dump silently failed.
SIZE=$(wc -c < "$BACKUP_DIR/$FILENAME")
if [ "$SIZE" -lt 10000 ]; then
  echo "✗ Backup looks too small (${SIZE} bytes) — something went wrong."
  rm -f "$BACKUP_DIR/$FILENAME"
  exit 1
fi

echo "✓ Backup saved: backups/$FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"

# Keep last 10 backups, remove older ones.
ls -t "$BACKUP_DIR"/smileys_backup_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
