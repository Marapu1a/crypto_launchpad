"""Manual, bounded Pons wallet snapshots. No RPC, signing or background polling."""
import json,re,sqlite3,time,threading,urllib.request,urllib.error,os
from decimal import Decimal,InvalidOperation
from contextlib import closing

TTL=300
GATE=threading.Lock()
LAST_REQUEST=0

def address(value):
    if not isinstance(value,str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}',value):
        raise ValueError('Invalid wallet address')
    return value.lower()

class ActivityAccessUnavailable(Exception):pass

def fetch(wallet,view):
    # Pons retired view=trades. The replacement currently blocks server clients.
    # Enable only after Pons authorizes server access; do not spoof browser headers.
    if view=='trades' and os.environ.get('PONS_ACTIVITY_SERVER_ACCESS')!='approved':
        raise ActivityAccessUnavailable('Pons server access is not available')
    url=f'https://balancesapi.ponsfamily.com/v1/wallets/{wallet}/activity' if view=='trades' else f'https://ponsfamily.com/api/profile/{wallet}?view=positions'
    req=urllib.request.Request(url,headers={'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=15) as response:
        raw=response.read(2_000_001)
    if len(raw)>2_000_000:raise ValueError('Response too large')
    data=json.loads(raw)
    if not isinstance(data,dict) or not isinstance(data.get('items'),list):raise ValueError('Invalid response')
    if len(data['items'])>1000:raise ValueError('Too many rows')
    if data.get('pending') or data.get('available') is False:raise ValueError('Source not ready')
    if view=='trades':
        data['items']=[activity_row(x) for x in data['items']]
    return data

def activity_row(row):
    if not isinstance(row,dict):raise ValueError('Invalid activity')
    raw=row.get('amount');decimals=row.get('decimals');amount=None
    if isinstance(raw,str) and re.fullmatch(r'\d{1,100}',raw) and type(decimals) is int and 0<=decimals<=36:
        digits=raw.zfill(decimals+1)
        amount=(digits[:-decimals]+'.'+digits[-decimals:]) if decimals else digits
    return dict(token=row.get('token'),txHash=row.get('tx'),kind=row.get('kind'),timestamp=row.get('time'),
                amountTokens=amount,valueUsd=row.get('usd'),symbol=row.get('symbol'),name=row.get('name'),counterparty=row.get('counterparty'))

def connect(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=10)
    db.execute('CREATE TABLE IF NOT EXISTS wallets(address TEXT PRIMARY KEY, first_seen REAL, attempted REAL, payload TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS wallet_events(wallet TEXT, identity TEXT, timestamp REAL, payload TEXT, PRIMARY KEY(wallet,identity))')
    return db

def event(row):
    if not isinstance(row,dict):raise ValueError('Invalid event')
    token=address(row.get('token'));tx=row.get('txHash','')
    if not re.fullmatch(r'0x[0-9a-fA-F]{64}',tx):raise ValueError('Invalid transaction')
    kind=row.get('kind');at=row.get('timestamp')
    if not isinstance(kind,str) or len(kind)>40 or not isinstance(at,(int,float)) or not 0<at<1e11:raise ValueError('Invalid event fields')
    result={k:row.get(k) for k in ('symbol','name','amountTokens','valueUsd','counterparty')}
    result.update(token=token,txHash=tx.lower(),kind=kind,timestamp=at)
    return tx.lower()+':'+token+':'+kind,result

def snapshot(path,wallet,loader=fetch,now=None):
    global LAST_REQUEST
    wallet=address(wallet);now=time.time() if now is None else now
    # Cached reads must never wait behind an unrelated network request.
    with closing(connect(path)) as cached_db:
        cached=cached_db.execute('SELECT attempted,payload FROM wallets WHERE address=?',(wallet,)).fetchone()
    saved=json.loads(cached[1]) if cached else {'address':wallet}
    cooldown=60 if saved.get('errors') else TTL
    if cached and now-cached[0]<cooldown:return saved
    if not GATE.acquire(blocking=False):return dict(saved,busy=True,retryAfter=3,error='Another wallet is loading. Try again shortly.')
    try:
        db=connect(path)
        try:
            old=db.execute('SELECT first_seen,attempted,payload FROM wallets WHERE address=?',(wallet,)).fetchone()
            if old and now-old[1]<(60 if json.loads(old[2]).get('errors') else TTL):return json.loads(old[2])
            if now-LAST_REQUEST<10:return dict(json.loads(old[2]) if old else {'address':wallet},busy=True,retryAfter=max(1,int(10-(now-LAST_REQUEST))+1),error='Please wait before loading another wallet.')
            if not old and db.execute('SELECT count(*) FROM wallets').fetchone()[0]>=200:
                return {'address':wallet,'error':'Local wallet limit reached (200).'}
            LAST_REQUEST=now
            first=old[0] if old else now
            result=dict(json.loads(old[2]) if old else {},address=wallet,firstObservedAt=first,attemptedAt=now,nextRefreshAt=now+TTL,errors={})
            previous_ids=set()
            for key,view in [('history','trades'),('positions','positions')]:
                try:
                    data=loader(wallet,view)
                    if key=='history':
                        grouped={}
                        for raw in data['items']:
                            identity,row=event(raw)
                            if identity not in grouped:
                                grouped[identity]=dict(row,sourceRows=1)
                            else:
                                previous=grouped[identity];previous['sourceRows']+=1
                                for field in ('amountTokens','valueUsd'):
                                    try:
                                        total=Decimal(str(previous[field]))+Decimal(str(row[field]))
                                        previous[field]=str(total) if total.is_finite() else None
                                    except InvalidOperation:previous[field]=None
                        events=list(grouped.items())
                        previous_ids={x[0] for x in db.execute('SELECT identity FROM wallet_events WHERE wallet=?',(wallet,))}
                        if previous_ids and events and not previous_ids.intersection(k for k,_ in events):result['gapPossible']=True
                        for identity,row in events:
                            db.execute('INSERT OR REPLACE INTO wallet_events VALUES (?,?,?,?)',(wallet,identity,row['timestamp'],json.dumps(row)))
                        # Bounded local retention. Tail snapshots are not complete wallet history.
                        db.execute('DELETE FROM wallet_events WHERE wallet=? AND identity NOT IN (SELECT identity FROM wallet_events WHERE wallet=? ORDER BY timestamp DESC LIMIT 5000)',(wallet,wallet))
                        result['historyUpdatedAt']=now;result['sourceRows']=len(data['items'])
                    else:
                        result['positions']=[{k:x.get(k) for k in ('token','symbol','name','amountTokens','valueUsd','state','reliable')} for x in data['items'] if isinstance(x,dict)]
                        result['positionsUpdatedAt']=now
                except Exception as exc:
                    result['errors'][key]=('HTTP_'+str(exc.code)) if isinstance(exc,urllib.error.HTTPError) else type(exc).__name__
            rows=[json.loads(x[0]) for x in db.execute('SELECT payload FROM wallet_events WHERE wallet=? ORDER BY timestamp DESC,identity',(wallet,))]
            result.update(events=rows,earliestAvailableAt=min((x['timestamp'] for x in rows),default=None),historyComplete=False,nativeBalance=None,
                          stats=dict(buys=sum(x['kind']=='buy' for x in rows),sells=sum(x['kind']=='sell' for x in rows),tokens=len({x['token'] for x in rows if x['kind'] in ('buy','sell')}),operations=len(rows)))
            if not result.get('historyUpdatedAt'):
                result['stats']={k:None for k in ('buys','sells','tokens','operations')}
            db.execute('INSERT OR REPLACE INTO wallets VALUES (?,?,?,?)',(wallet,first,now,json.dumps(result)));db.commit()
            return result
        finally:db.close()
    finally:GATE.release()
