#!/bin/bash
# Native QIANQI format; helper from rh_project@11a050d, no state conversion.
set -euo pipefail
umask 077
exec 9>/run/lock/qianqi-public-backup.lock
flock -n 9
helper=/opt/crypto-launchpad/ops/qianqi/native-backup.cjs
printf '%s  %s\n' c260d7bbdf71134ccc8606d16940c9d25c978b532e674ad810e4cffe5229d312 "$helper" | sha256sum -c -
units=(qianqi-public-automation.service qianqi-public-indexer.service)
active=()
directories=()
manifests=()
# Validate helpers and both release formats BEFORE stopping writers.
for unit in "${units[@]}"; do
 directory=$(readlink -f "$(systemctl show "$unit" -p WorkingDirectory --value)")
 case "$directory" in /opt/qianqi/releases/*|/opt/crypto-launchpad/releases/*) ;; *) exit 1 ;; esac
 manifest="$directory/platform-release.json"
 if test ! -f "$manifest"; then manifest="$directory/release.json"; fi
 test -f "$manifest"
 directories+=("$directory")
 manifests+=("$manifest")
 if systemctl is-active --quiet "$unit"; then active+=("$unit"); fi
done
systemctl stop "${units[@]}"
for unit in "${units[@]}"; do
 test "$(systemctl show "$unit" -p MainPID --value)" = 0
done
target="/var/backups/qianqi-public/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p /var/backups/qianqi-public
node "$helper" backup /var/lib/qianqi-public "$target"
cp -a /etc/qianqi/public "$target/config"
cp "${manifests[0]}" "$target/release.json"
sha256sum "$target/release.json" > "$target/release.sha256"
mkdir "$target/runtimes"
for i in "${!units[@]}"; do
 cp "${manifests[i]}" "$target/runtimes/${units[i]}.release.json"
 printf '%s\n' "${directories[i]}" > "$target/runtimes/${units[i]}.directory.txt"
done
tar -czf "$target.tar.gz.tmp" -C "$(dirname "$target")" "$(basename "$target")"
mv "$target.tar.gz.tmp" "$target.tar.gz"
(cd "$(dirname "$target")"; sha256sum "$(basename "$target").tar.gz") > "$target.sha256.tmp"
mv "$target.sha256.tmp" "$target.sha256"
# Preserve fail-closed native semantics on inconsistent or incomplete backups.
for ((i=${#active[@]}-1; i>=0; i--)); do systemctl start "${active[i]}"; done
echo "Backup complete: $target. Export off-server separately."
