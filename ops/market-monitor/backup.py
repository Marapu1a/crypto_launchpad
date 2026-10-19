import sqlite3,pathlib,datetime
root=pathlib.Path('/var/backups/pons-market-monitor');root.mkdir(parents=True,exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
for name in ['market','wallets']:
 source=pathlib.Path('/var/lib/pons-market-monitor')/(name+'.sqlite3')
 if not source.exists():continue
 with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as s,sqlite3.connect(root/(name+'-'+stamp+'.sqlite3')) as d:
  s.backup(d)
  if d.execute('pragma integrity_check').fetchone()[0]!='ok':raise RuntimeError('Backup integrity failed')
 # Keep the latest 14 independent snapshots.
 for old in sorted(root.glob(name+'-*.sqlite3'))[:-14]:old.unlink()
print(stamp)
