#!/usr/bin/python3
"""Bounded rehearsal observations; no environment, credentials or QIANQI journals."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

root = Path('/var/lib/crypto-launchpad')
marker = json.loads((root / 'shadow/rehearsal.json').read_text())
now = time.time()
record = {'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'deadline': marker['deadline'], 'executionEligible': False, 'services': {}}
for name in ['crypto-launchpad-shadow', 'postgresql@18-main',
             'qianqi-public-indexer', 'qianqi-public-automation']:
    out = subprocess.check_output(['systemctl', 'show', name,
        '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID', '-p', 'MemoryCurrent',
        '-p', 'NRestarts', '-p', 'ExecMainStatus'], text=True, timeout=10)
    record['services'][name] = dict(line.split('=', 1) for line in out.splitlines() if '=' in line)
record['loadAverage'] = os.getloadavg()
record['memAvailableKiB'] = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
record['freeBytes'] = os.statvfs(root).f_bavail * os.statvfs(root).f_frsize
record['databaseBytes'] = int(subprocess.check_output(['runuser', '-u', 'postgres', '--',
    'psql', '-At', '-d', 'launchpad_shadow', '-c', 'select pg_database_size(current_database())'], text=True, timeout=10).strip())
record['walBytes'] = sum(p.stat().st_size for p in Path('/var/lib/postgresql/18/main/pg_wal').iterdir() if p.is_file())
record['stateBytes'] = int(subprocess.check_output(['du', '-sb', str(root / 'shadow')], text=True, timeout=10).split()[0])
try:
    record['latest'] = json.loads((root / 'shadow/latest.json').read_text())
except (FileNotFoundError, json.JSONDecodeError):
    record['latest'] = None
start = time.monotonic()
try:
    with urllib.request.urlopen('https://qianqi.site/v1/overview?limit=1', timeout=15) as response:
        overview = json.load(response)
        record['qianqiApi'] = {'http': response.status, 'status': overview.get('status'),
                              'head': overview.get('provenance', {}).get('head')}
except Exception:
    record['qianqiApi'] = {'status': 'UNAVAILABLE'}
record['qianqiApi']['elapsedMs'] = round((time.monotonic() - start) * 1000)
record['window'] = 'WINDOW_ENDED_REVIEW_REQUIRED' if now * 1000 >= marker['deadline'] else 'OBSERVING'
directory = root / 'metrics'
directory.mkdir(mode=0o700, exist_ok=True)
target = directory / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
target.write_text(json.dumps(record, indent=2))
print(record['window'], target.name)
if record['window'] == 'WINDOW_ENDED_REVIEW_REQUIRED':
    subprocess.run(['systemctl', 'disable', '--now', 'crypto-launchpad-monitor.timer'], check=True)
