#!/bin/bash
set -e

SERVER="${SMILEYS_DEPLOY_SERVER:-root@178.105.37.133}"
BACKUP_DIR="/Users/nate/smileys-community/backups"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILENAME="smileys_backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "→ Dumping production database..."
ssh "$SERVER" "PGPASSWORD=smileys123 pg_dump -U smileys -h localhost smileys_db" > "$BACKUP_DIR/$FILENAME"

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
