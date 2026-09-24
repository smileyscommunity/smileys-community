#!/bin/bash
# Nightly backup of the server's data/ folder: the JSON the admin panel edits
# in place (city guide, content/FAQ, settings, banners, announcement,
# neighbourhoods, guide experiences…). deploy.sh excludes these from its
# rsync, so the server copy is the only one — and db-backup.sh covers
# Postgres only, so a bad admin save had no way back.
#
# Stored OUTSIDE /root/smileys-community for the reason db-backup.sh gives:
# deploy.sh's `rsync --delete` wipes any file on the server that isn't in the
# local tree. Two hand-made .bak copies left beside the originals in data/
# were deleted by the next deploy on 2026-09-24.
#
# The whole folder, not a list of files: it's ~0.5 MB, and a list would miss
# the next file someone adds to the admin panel.
set -euo pipefail

SRC_ROOT="${SMILEYS_ROOT:-/root/smileys-community}"
BACKUP_DIR="/root/data-backups"
KEEP=30
mkdir -p "$BACKUP_DIR"

TS=$(date -u +%Y-%m-%d_%H-%M-%S)
FILE="$BACKUP_DIR/data_${TS}.tar.gz"
PART="$FILE.part"

if [ ! -d "$SRC_ROOT/data" ]; then
  echo "✗ $SRC_ROOT/data not found — nothing written, keeping prior backups" >&2
  exit 1
fi

# .part then rename, as in db-backup.sh: a failed tar must not leave a
# truncated archive that counts toward the ones kept.
if ! tar -czf "$PART" -C "$SRC_ROOT" data; then
  echo "✗ tar failed — nothing written, keeping prior backups" >&2
  rm -f "$PART"
  exit 1
fi

# Sanity: the folder holds dozens of JSON files; an archive this small means
# it came out empty.
SIZE=$(stat -c%s "$PART" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 10000 ]; then
  echo "✗ Backup too small (${SIZE} bytes) — removing, keeping prior backups" >&2
  rm -f "$PART"
  exit 1
fi
mv "$PART" "$FILE"

# Retention: keep the $KEEP most recent (a month of nightly runs).
ls -t "$BACKUP_DIR"/data_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "✓ Data backup: $FILE ($(du -h "$FILE" | cut -f1)) — $(ls "$BACKUP_DIR"/data_*.tar.gz | wc -l) kept"
