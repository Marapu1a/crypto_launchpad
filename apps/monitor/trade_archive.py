"""Append observed Pons trades before market filters; never query the network."""
import sqlite3,json
from contextlib import contextmanager
from wallet_activity import summarize_wallets
@contextmanager
def connect(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS trades(seq INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, event_id TEXT, timestamp REAL, payload TEXT, UNIQUE(token,event_id))')
            db.execute('CREATE INDEX IF NOT EXISTS trades_time ON trades(timestamp)')
            db.execute('CREATE TABLE IF NOT EXISTS scans(end INTEGER PRIMARY KEY, complete INTEGER)')
            yield db
    finally:db.close()

def append(path,histories,end,complete):
    with connect(path) as db:
        for token,rows,_ in histories:
            for row in rows:
                if row['timestamp']>=end:continue
                data={**row,'token':token['address'].lower(),'symbol':token.get('symbol'),'quoteUsd':token.get('quoteUsd'),'quote':token['quote']['symbol'],
                      'eligible':row['side']=='buy' and row.get('venue')=='curve' and token['createdAt']<=row['timestamp']<token['createdAt']+3600 and row['trader'].lower()!=token['deployer'].lower()}
                db.execute('INSERT OR IGNORE INTO trades(token,event_id,timestamp,payload) VALUES(?,?,?,?)',(data['token'],str(row['id']),row['timestamp'],json.dumps(data)))
        db.execute('INSERT OR REPLACE INTO scans VALUES(?,?)',(end,int(complete)))
        db.execute('DELETE FROM trades WHERE timestamp<?',(end-28*86400,))
        db.execute('DELETE FROM scans WHERE end<?',(end-28*86400,))

def ranking(path,end,minutes):
    if minutes not in (5,30,60):raise ValueError('Invalid period')
    start=end-minutes*60
    with connect(path) as db:
        rows=[json.loads(x[0]) for x in db.execute('SELECT payload FROM trades WHERE timestamp>=? AND timestamp<?',(start,end))]
        scans=dict(db.execute('SELECT end,complete FROM scans WHERE end>? AND end<=?',(start,end)))
    complete=all(scans.get(t)==1 for t in range(start+300,end+1,300))
    return dict(windowEnd=end,minutes=minutes,complete=complete,walletActivity=summarize_wallets([x for x in rows if x['eligible']],end,minutes))

def feed(path,after):
    with connect(path) as db:
        maximum=db.execute("SELECT seq FROM sqlite_sequence WHERE name='trades'").fetchone()
        maximum=maximum[0] if maximum else 0
        rows=[] if after is None else [dict(json.loads(p),seq=n) for n,p in db.execute('SELECT seq,payload FROM trades WHERE seq>? ORDER BY seq LIMIT 500',(after,))]
    return dict(cursor=maximum,events=rows)
