#!/bin/sh
set -eu
umask 077
test "$(id -u)" = 0
root=/var/backups/pons-runtime
mkdir -p "$root"
exec 9>"$root/backup.lock"
flock -n 9 || exit 0
resume=0
finish() { if test "$resume" = 1; then systemctl start pons-runtime.service; fi; }
trap finish EXIT
trap 'exit 1' HUP INT TERM
if systemctl is-active --quiet pons-runtime.service; then
 resume=1
 systemctl stop pons-runtime.service
fi
dest="$root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 "$dest"
runuser -u postgres -- pg_dump -Fc launchpad_shadow > "$dest/database.dump"
tar -czf "$dest/state.tar.gz" /var/lib/crypto-launchpad/pons-runtime /var/lib/crypto-launchpad/pons-public \
 /etc/crypto-launchpad/pons /etc/crypto-launchpad/qianqi-api-registry.json \
 /var/lib/qianqi-public/automation.json /var/lib/qianqi-public/automation.json.rng /var/lib/qianqi-public/automation.json.scheduler
# Collector SQLite may be writing; use its transactional backup API.
python3 - "$dest" <<'PY'
import sqlite3,sys,pathlib
base=pathlib.Path('/var/lib/crypto-launchpad/pons-preflight')
with sqlite3.connect('file:'+str(base/'purchases.sqlite')+'?mode=ro',uri=True) as source:
 with sqlite3.connect(str(pathlib.Path(sys.argv[1])/'purchases.sqlite')) as target: source.backup(target)
PY
cp /var/lib/crypto-launchpad/pons-preflight/budget.json "$dest/budget.json"
cp /var/lib/crypto-launchpad/pons-preflight/profiles.json "$dest/profiles.json"
(cd "$dest" && sha256sum database.dump state.tar.gz purchases.sqlite budget.json profiles.json > SHA256SUMS && sha256sum -c SHA256SUMS)
pg_restore --list "$dest/database.dump" >/dev/null
tar -tzf "$dest/state.tar.gz" >/dev/null
touch "$dest/COMPLETE"
