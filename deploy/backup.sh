#!/bin/sh
# نسخ احتياطي يومي لقاعدة البيانات مع الاحتفاظ بآخر 30 نسخة.
# أضفه إلى cron:  30 2 * * * /opt/smart-advisor/deploy/backup.sh >> /var/log/smart-advisor-backup.log 2>&1
set -eu
DIR=${BACKUP_DIR:-/var/backups/smart-advisor}
KEEP=${BACKUP_KEEP:-30}
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'db'; then
  CONTAINER=$(docker ps --format '{{.Names}}' | grep -m1 'db')
  docker exec "$CONTAINER" pg_dump -U advisor -d advisor -Fc > "$DIR/advisor-$STAMP.dump"
else
  pg_dump "${DATABASE_URL:?DATABASE_URL غير مضبوط}" -Fc > "$DIR/advisor-$STAMP.dump"
fi
ls -1t "$DIR"/advisor-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "$(date) ✔ backup $DIR/advisor-$STAMP.dump"
