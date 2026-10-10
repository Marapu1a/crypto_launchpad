#!/bin/sh
set -eu
umask 077
test "$(id -u)" = 0
root=/var/backups/crypto-launchpad-short
mkdir -p "$root"
exec 9>"$root/backup.lock"
flock -n 9 || exit 0
resume=0
restore_service() { if test "$resume" = 1; then systemctl start crypto-launchpad-short.service; fi; }
trap restore_service EXIT
trap 'exit 1' HUP INT TERM
if systemctl is-active --quiet crypto-launchpad-short.service; then
 resume=1
 systemctl stop crypto-launchpad-short.service
fi
dest="$root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 "$dest"
runuser -u postgres -- pg_dump -Fc launchpad_shadow > "$dest/database.dump"
# Only encrypted keys and runtime health belong here. Passwords/RPC/DB credentials
# live separately under short-secrets and are never copied into this archive.
tar -czf "$dest/runtime.tar.gz" -C /var/lib/crypto-launchpad short
cp /etc/crypto-launchpad/short-runtime.json "$dest/runtime.json"
readlink -f /opt/crypto-launchpad/short-current > "$dest/release.txt"
(cd "$dest" && sha256sum database.dump runtime.tar.gz runtime.json release.txt > SHA256SUMS)
touch "$dest/COMPLETE"
