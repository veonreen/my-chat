#!/bin/bash
# MyChat daily encrypted backup (cron se roz 03:00 IST).
# SQLite ka consistent snapshot + encrypted files => `age` (public-key) se encrypt.
# Server par sirf PUBLIC key hai; PRIVATE key sirf owner ke PC par => server hack ho to bhi backup nahi khulta.
set -euo pipefail
RECIPIENT="age1ldau7cqnxfq2luecuxakl7dzaaw4n5sxs4l0k49hm66fpqqyjeqq0tmwcr"
APP=/docker/mychat
OUT=$APP/backups
KEEP_DAYS=14
TS=$(date +%F-%H%M)

umask 077
mkdir -p "$OUT"
docker exec mychat node backup.js "/data/backups/snap-$TS.db"
tar -C "$APP/data" -cf - "backups/snap-$TS.db" files | gzip -9 | age -r "$RECIPIENT" -o "$OUT/mychat-$TS.tar.gz.age"
rm -f "$APP/data/backups/snap-$TS.db"
chown -R mychat:mychat "$OUT"
find "$OUT" -name 'mychat-*.tar.gz.age' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $OUT/mychat-$TS.tar.gz.age ($(du -h "$OUT/mychat-$TS.tar.gz.age" | cut -f1))"
