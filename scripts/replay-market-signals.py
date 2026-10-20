"""Replay saved market samples into a separate shadow journal. No network or sends."""
import argparse,json,pathlib,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/monitor'))
import market_signals
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--database',required=True,type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path)
p.add_argument('--config',type=pathlib.Path)
p.add_argument('--resume',action='store_true',help='Resume the same immutable source and configuration')
a=p.parse_args()
if a.database.resolve()==a.output.resolve():p.error('Output must be separate from source')
if a.output.exists() and not a.resume:p.error('Use a new output path to preserve prior experiments')
config=json.loads(a.config.read_text(encoding='utf-8')) if a.config else dict(market_signals.DEFAULT)
config={**config,'runMode':'replay'}
db=sqlite3.connect(a.database.resolve().as_uri()+'?mode=ro',uri=True)
try:rows=db.execute('SELECT end,payload FROM samples ORDER BY end').fetchall()
finally:db.close()
a.output.parent.mkdir(parents=True,exist_ok=True)
keeper=sqlite3.connect(a.output)
keeper.execute('PRAGMA journal_mode=WAL')
start=0
if a.resume:
    row=keeper.execute('SELECT max(end) FROM decisions WHERE config=?',(market_signals.fingerprint(config),)).fetchone()
    start=row[0] or 0
history={};counts={}
for end,raw in rows:
    history[end]=json.loads(raw)
    history={t:v for t,v in history.items() if t>=end-3900}
    if end<=start:continue
    decision=market_signals.record(a.output,history,end,end+60,config)
    counts[decision['status']]=counts.get(decision['status'],0)+1
counts=dict(keeper.execute("SELECT json_extract(payload,'$.status'),count(*) FROM decisions GROUP BY json_extract(payload,'$.status')"))
keeper.close()
result=market_signals.report(a.output)
print(json.dumps(dict(windows=len(rows),decisions=counts,episodes=result['totalEpisodes'],delivery=False,
                     limitation='Reconstructed saved history, not original as-of revisions. No calibration or live delivery proven.'),ensure_ascii=False))
