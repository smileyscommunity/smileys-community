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
# ServerAlive* is load-bearing, not tidiness. On 2026-08-20 a dump stalled at
# 13.4MB for over an hour: the server had finished and no pg_dump was running
# there, but the TCP session had died silently (an idle NAT/firewall drop is
# the usual cause) and ssh, with no keepalive, waited forever on a connection
# that would never deliver another byte. A deploy was blocked behind it. Now
# the connection is probed every 15s and gives up after 4 misses, so a dead
# session fails in about a minute instead of hanging until someone notices.
ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=20 "$SERVER" 'PGPASSWORD=$(sed -n "s|.*://smileys:\([^@]*\)@.*|\1|p" /root/smileys-community/.env | head -1); [ -n "$PGPASSWORD" ] || { echo "could not read DB password from server .env" >&2; exit 1; }; export PGPASSWORD; pg_dump -U smileys -h localhost smileys_db' > "$BACKUP_DIR/$FILENAME"

# Sanity check — an empty or tiny file means pg_dump silently failed.
SIZE=$(wc -c < "$BACKUP_DIR/$FILENAME")
if [ "$SIZE" -lt 10000 ]; then
  echo "✗ Backup looks too small (${SIZE} bytes) — something went wrong."
  rm -f "$BACKUP_DIR/$FILENAME"
  exit 1
fi

# Size alone is not proof. The stalled dump above reached 13.4MB — a third of a
# real backup, and comfortably past any size threshold, while missing most of
# the data. pg_dump writes this marker as its last line, so it is the only
# cheap statement that the file is COMPLETE rather than merely large. A
# truncated backup that looks fine is worse than no backup, because it is the
# one you reach for after something has already gone wrong.
if ! tail -5 "$BACKUP_DIR/$FILENAME" | grep -q "PostgreSQL database dump complete"; then
  echo "✗ Backup is truncated (${SIZE} bytes, no completion marker) — the dump did not finish."
  rm -f "$BACKUP_DIR/$FILENAME"
  exit 1
fi

echo "✓ Backup saved: backups/$FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"

# Keep last 10 backups, remove older ones.
ls -t "$BACKUP_DIR"/smileys_backup_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
