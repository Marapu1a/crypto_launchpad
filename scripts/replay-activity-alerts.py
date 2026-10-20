"""Replay saved samples into a separate local journal; no network or delivery."""
import argparse,json,pathlib,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps'/'monitor'))
import activity_alerts
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--database',type=pathlib.Path,required=True)
p.add_argument('--output',type=pathlib.Path,required=True)
a=p.parse_args()
if a.database.resolve()==a.output.resolve() or a.output.exists():p.error('Output must be a new, separate file')
source=sqlite3.connect(a.database.resolve().as_uri()+'?mode=ro',uri=True)
keeper=activity_alerts.connect(a.output)
try:
 keeper.execute('PRAGMA journal_mode=WAL');history={};count=0
 for end,raw in source.execute('SELECT end,payload FROM samples ORDER BY end'):
  history[end]=dict(json.loads(raw),windowEnd=end)
  history={t:w for t,w in history.items() if t>=end-1800}
  activity_alerts.record(a.output,history,end,end+1);count+=1
 events=keeper.execute('SELECT count(*) FROM events').fetchone()[0]
 print(json.dumps(dict(windows=count,events=events,delivery=False,
  limitation='Reconstructed saved history, not original as-of data or validated thresholds')))
finally:keeper.close();source.close()
