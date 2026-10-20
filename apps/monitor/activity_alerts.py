"""Simple market activity, using saved aggregates only. No delivery or network."""
import json, sqlite3, statistics
from contextlib import closing

# Calibration candidates, not claims about profitability or organic demand.
CONFIG = dict(version='activity-v1', buyersMin=20, buysMin=30,
              buyersFactor=3, buysFactor=2, quietWindows=3, maxAge=900)

def good(w):
    return bool(w and w.get('complete') is True and not w.get('error') and all(
        isinstance(w.get('current', {}).get(k), (int, float)) and w['current'][k]>=0
        for k in ('buyers','buys')))

def evaluate(history,end):
    windows=[history.get(t) for t in range(end-1800,end+1,300)]
    if end%300 or not all(good(w) for w in windows):return None
    base={k:statistics.mean(w['current'][k] for w in windows[:-1]) for k in ('buyers','buys')}
    current=windows[-1]['current']
    trigger=(current['buyers']>=max(CONFIG['buyersMin'],base['buyers']*CONFIG['buyersFactor']) and
             current['buys']>=max(CONFIG['buysMin'],base['buys']*CONFIG['buysFactor']))
    return dict(trigger=trigger,baseline=base,current=current)

def connect(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=15)
    db.executescript('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,payload TEXT);'
                    'CREATE TABLE IF NOT EXISTS events(end INTEGER PRIMARY KEY,payload TEXT);')
    return db

def record(path,history,end,now):
    with closing(connect(path)) as db,db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT payload FROM state WHERE id=1').fetchone()
        state=json.loads(row[0]) if row else dict(end=0,active=False,quiet=0)
        if end<=state['end']:return
        result=evaluate(history,end) if 0<=now-end<=CONFIG['maxAge'] else None
        if state['active']:
            w=history.get(end)
            low=0<=now-end<=CONFIG['maxAge'] and good(w) and (
                w['current']['buyers']<max(CONFIG['buyersMin'],state['baseline']['buyers']*1.5) or
                w['current']['buys']<max(CONFIG['buysMin'],state['baseline']['buys']*1.2))
            state['quiet']=(state['quiet']+1 if end==state['end']+300 else 1) if low else 0
            if state['quiet']>=CONFIG['quietWindows']:state['active']=False
        if result and result['trigger'] and not state['active']:
            state.update(active=True,quiet=0,baseline=result['baseline'])
            # Freeze exact evidence, including the comparison windows and token table.
            windows=[{k:v for k,v in history[t].items() if k!='walletActivity'} for t in range(end-1800,end+1,300)]
            event=dict(windowEnd=end,config=CONFIG,baseline=result['baseline'],current=result['current'],
                       snapshot=dict(windows[-1],intervals=windows,preview=True,historical=True))
            db.execute('INSERT OR IGNORE INTO events VALUES(?,?)',(end,json.dumps(event)))
        state['end']=end
        db.execute('INSERT OR REPLACE INTO state VALUES(1,?)',(json.dumps(state),))
        db.execute('DELETE FROM events WHERE end<?',(now-28*86400,))

def feed(path):
    with closing(connect(path)) as db:
        return dict(events=[json.loads(r[0]) for r in db.execute('SELECT payload FROM events ORDER BY end DESC LIMIT 50')])

def snapshot(path,end):
    with closing(connect(path)) as db:
        row=db.execute('SELECT payload FROM events WHERE end=?',(end,)).fetchone()
        return json.loads(row[0])['snapshot'] if row else None
