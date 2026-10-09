#!/bin/sh
set -eu
umask 077
root=/var/backups/crypto-launchpad
state=/var/lib/crypto-launchpad
test "$(id -u)" = 0
test -d "$root"
exec 9>"$root/backup.lock"
flock -n 9 || exit 0
# Never delete historical backups automatically during the rehearsal.
used=$(du -sb "$root" | cut -f1)
free=$(df -B1 --output=avail "$root" | tail -1 | tr -d ' ')
test "$used" -lt 3221225472
test "$free" -gt 10737418240
restart=0
resume() { if test "$restart" = 1; then systemctl start crypto-launchpad-shadow.service; fi; }
trap resume EXIT
trap 'exit 1' HUP INT TERM
if systemctl is-active --quiet crypto-launchpad-shadow.service; then
 restart=1
 systemctl stop crypto-launchpad-shadow.service
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$root/$stamp"
mkdir -m 0700 "$dest"
runuser -u postgres -- pg_dump -Fc launchpad_shadow > "$dest/database.dump"
if test -d "$state/metrics"; then
 tar -czf "$dest/evidence.tar.gz" -C "$state" bootstrap shadow metrics
else
 tar -czf "$dest/evidence.tar.gz" -C "$state" bootstrap shadow
fi
readlink -f /opt/crypto-launchpad/current > "$dest/release.txt"
if test -L /opt/crypto-launchpad/qianqi-current; then
 readlink -f /opt/crypto-launchpad/qianqi-current > "$dest/qianqi-release.txt"
fi
if test -f /etc/crypto-launchpad/continuous-backup; then
 # Explicit non-secret platform bindings only; RPC credentials/keystores are excluded.
 tar -czf "$dest/platform-config.tar.gz" -C /etc/crypto-launchpad \
  existing-qianqi/executor.json existing-qianqi/indexer.json qianqi-api-registry.json
 tar -czf "$dest/platform-units.tar.gz" -C /etc/systemd/system \
  crypto-launchpad-api.service qianqi-public-indexer.service.d/zz-launchpad.conf \
  qianqi-public-automation.service.d/zz-launchpad.conf qianqi-public-backup.service.d/zz-launchpad.conf
 tar -czf "$dest/postgres-config.tar.gz" -C /etc/postgresql/18/main \
  pg_hba.conf pg_ident.conf conf.d/launchpad.conf
 qianqi_release=$(readlink -f /opt/crypto-launchpad/qianqi-current)
 case "$qianqi_release" in /opt/crypto-launchpad/releases/*) ;; *) exit 1 ;; esac
 tar --exclude=./node_modules -czf "$dest/qianqi-runtime.tar.gz" -C "$qianqi_release" .
 tar -czf "$dest/platform-ops.tar.gz" -C /opt/crypto-launchpad/ops \
  verify-release.mjs backup.sh monitor.py qianqi/native-backup.cjs qianqi/backup-public.sh
fi
date -u +%FT%TZ > "$dest/captured-at.txt"
(cd "$dest" && for file in database.dump evidence.tar.gz release.txt captured-at.txt \
 qianqi-release.txt platform-config.tar.gz platform-units.tar.gz postgres-config.tar.gz \
 qianqi-runtime.tar.gz platform-ops.tar.gz; do
 if test -f "$file"; then sha256sum "$file"; fi
done > SHA256SUMS)
tar -czf "$root/$stamp.tar.gz" -C "$root" "$stamp"
(cd "$root" && sha256sum "$stamp.tar.gz" > "$stamp.tar.gz.sha256")
printf '%s\n' "$stamp.tar.gz" > "$root/latest.tmp"
mv "$root/latest.tmp" "$root/latest"
printf 'BACKUP_OK %s\n' "$stamp"
# The last backup after the durable rehearsal deadline ends this temporary timer.
if test ! -f /etc/crypto-launchpad/continuous-backup && test -f "$state/shadow/rehearsal.json"; then
 if python3 -c 'import json,time; import sys; sys.exit(0 if time.time()*1000 >= json.load(open("/var/lib/crypto-launchpad/shadow/rehearsal.json"))["deadline"] else 1)'; then
  restart=0
  systemctl disable --now crypto-launchpad-backup.timer
 fi
fi
