"""Experimental market signals. Local snapshots only; no network or delivery code."""
import copy, hashlib, json, sqlite3, statistics
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation

DEFAULT = dict(version='market-shadow-v1', buyersMin=12, buysMin=20,
               buyerFactor='1.8', buyFactor='1.5', volumeFactor='3',
               quietWindows=3, maxAge=900,
               assets={'0x0000000000000000000000000000000000000000':dict(symbol='ETH',floor='0.05'),
                       '0x5fc5360d0400a0fd4f2af552add042d716f1d168':dict(symbol='USDG',floor='100')})

def number(value):
    try:
        n=Decimal(str(value))
        return n if n.is_finite() and n>=0 else None
    except (InvalidOperation,ValueError):return None

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def good(window):
    return bool(window and window.get('complete') is True and not window.get('error')
                and all(number(window.get('current',{}).get(k)) is not None for k in ('buyers','buys')))

def volume(window,asset):
    # Missing asset is a known zero only in a complete, explicitly populated volume list.
    if not good(window) or not isinstance(window.get('volumes'),list):return None
    rows=[x for x in window['volumes'] if str(x.get('asset','')).lower()==asset]
    if not rows:return Decimal(0)
    if len(rows)!=1 or rows[0].get('missingAmounts')!=0:return None
    return number(rows[0].get('volume'))

def evidence(window):
    # Public aggregate context only: no wallet lists, private notes or raw events.
    return {k:copy.deepcopy(window[k]) for k in ('windowEnd','current','volumes','board','complete','error','coverage','breadth','collectedAt') if k in window}

def evaluate(history,end,now,config=None):
    """Pure decision; two elevated windows versus a preceding hour, assets kept separate."""
    c=config or DEFAULT;current=history.get(end)
    result=dict(windowEnd=end,mode=c.get('runMode','shadow'),config=copy.deepcopy(c),configId=fingerprint(c),
                scope='Pons V2 curve BUY, first hour, excluding creator',checks=[])
    if end%300 or not good(current) or not 0<=now-end<=c['maxAge']:
        result['status']='insufficient';result['reason']='stale_or_incomplete';return result
    result['window']=evidence(current)
    def check(kind,times):
        x=dict(kind=kind,baselineEnds=times,trigger=False,status='insufficient')
        result['checks'].append(x)
        return x
    baseline=list(range(end-3900,end-300,300))
    x=check('activity',baseline)
    if all(good(history.get(t)) for t in baseline+[end-300]):
        mb=statistics.median(number(history[t]['current']['buyers']) for t in baseline)
        mn=statistics.median(number(history[t]['current']['buys']) for t in baseline)
        tb=max(Decimal(c['buyersMin']),mb*Decimal(c['buyerFactor']))
        tn=max(Decimal(c['buysMin']),mn*Decimal(c['buyFactor']))
        values=[{k:history[t]['current'][k] for k in ('buyers','buys')} for t in (end-300,end)]
        x.update(status='ready',baseline=dict(buyers=str(mb),buys=str(mn)),
                 thresholds=dict(buyers=str(tb),buys=str(tn)),values=values,
                 trigger=all(number(v['buyers'])>=tb and number(v['buys'])>=tn for v in values))
    for asset,settings in c['assets'].items():
        times=list(range(end-3600,end,300));x=check('volume:'+asset,times)
        values=[volume(history.get(t),asset) for t in times+[end]]
        if all(v is not None for v in values):
            median=statistics.median(values[:-1]);threshold=max(Decimal(settings['floor']),median*Decimal(c['volumeFactor']))
            context=next((v for v in current['volumes'] if str(v.get('asset','')).lower()==asset),{})
            x.update(status='ready',asset=asset,symbol=settings['symbol'],baseline=str(median),
                     threshold=str(threshold),value=str(values[-1]),buyers=context.get('buyers',0),
                     buys=context.get('buys',0),maximum=context.get('maximum'),top3Pct=context.get('top3Pct'),
                     # Single-address volume stays visible as a candidate, explicitly labelled.
                     concentrated=context.get('buyers',0)==1,trigger=values[-1]>=threshold)
    result['status']='candidate' if any(x['trigger'] for x in result['checks']) else 'clear' if all(x['status']=='ready' for x in result['checks']) else 'insufficient'
    return result

@contextmanager
def connect(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS decisions(config TEXT,end INTEGER,digest TEXT,payload TEXT,PRIMARY KEY(config,end))')
            db.execute('CREATE TABLE IF NOT EXISTS revisions(config TEXT,end INTEGER,digest TEXT,payload TEXT,PRIMARY KEY(config,end,digest))')
            db.execute('CREATE TABLE IF NOT EXISTS state(config TEXT PRIMARY KEY,payload TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,config TEXT,first_end INTEGER,last_end INTEGER,payload TEXT)')
            yield db
    finally:db.close()

def below(check,window,config):
    if not good(window):return None
    if check['kind']=='activity':
        b=number(window['current']['buyers']);n=number(window['current']['buys'])
        return b<max(Decimal(config['buyersMin']),Decimal(check['baseline']['buyers'])*Decimal('1.2')) or n<max(Decimal(config['buysMin']),Decimal(check['baseline']['buys'])*Decimal('1.1'))
    amount=volume(window,check['asset'])
    if amount is None:return None
    return amount<max(Decimal(config['assets'][check['asset']]['floor']),Decimal(check['baseline'])*Decimal('1.5'))

def record(path,history,end,now,config=None):
    """Persist first-seen decisions and episode state atomically. Never enqueue a message."""
    c=config or DEFAULT;decision=evaluate(history,end,now,c);key=decision['configId']
    digest=fingerprint({str(t):evidence(history[t]) for t in range(end-3900,end+1,300) if t in history})
    with connect(path) as db:
        db.execute('BEGIN IMMEDIATE')
        old=db.execute('SELECT digest,payload FROM decisions WHERE config=? AND end=?',(key,end)).fetchone()
        if old:
            if old[0]!=digest:
                revision=dict(decision,reason='revised_after_first_evaluation',delivery=False)
                db.execute('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?)',(key,end,digest,json.dumps(revision)))
            return json.loads(old[1])
        row=db.execute('SELECT payload FROM state WHERE config=?',(key,)).fetchone()
        state=json.loads(row[0]) if row else dict(lastEnd=0,active={},episode=None)
        if end<=state['lastEnd']:
            decision.update(status='historical',reason='out_of_order',delivery=False)
        else:
            consecutive=end==state['lastEnd']+300
            fresh=0<=now-end<=c['maxAge']
            for kind,active in list(state['active'].items()):
                low=below(active['check'],history.get(end),c) if fresh else None
                active['quiet']=active['quiet']+1 if consecutive and low else 1 if low else 0
                if active['quiet']>=c['quietWindows']:del state['active'][kind]
            episode=None
            if state['episode']:
                episode=json.loads(db.execute('SELECT payload FROM episodes WHERE id=?',(state['episode'],)).fetchone()[0])
            if episode and not state['active']:
                episode.update(status='closed',lastEnd=end)
                db.execute('UPDATE episodes SET last_end=?,payload=? WHERE id=?',(end,json.dumps(episode),episode['id']))
                state['episode']=None;episode=None
            new=[x for x in decision['checks'] if x['trigger'] and x['kind'] not in state['active']]
            if new:
                if episode is None:
                    ident=fingerprint(dict(config=key,end=end))[:24]
                    episode=dict(id=ident,configId=key,firstEnd=end,lastEnd=end,status='active',mode=c.get('runMode','shadow'),delivery=False,reasons=[],windows={})
                    state['episode']=ident
                for x in new:
                    state['active'][x['kind']]=dict(check=x,quiet=0)
                    episode['reasons'].append(dict(x,windowEnd=end))
                    for t in [*x['baselineEnds'],end-300,end]:
                        if t in history:episode['windows'].setdefault(str(t),evidence(history[t]))
                episode['lastEnd']=end
                db.execute('INSERT INTO episodes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_end=excluded.last_end,payload=excluded.payload',(episode['id'],key,episode['firstEnd'],end,json.dumps(episode)))
            decision.update(episodeId=state['episode'],newReasons=[x['kind'] for x in new],delivery=False)
            if state['episode'] and not new:decision['status']='continuing' if fresh and good(history.get(end)) else 'insufficient'
            state['lastEnd']=end
            db.execute('INSERT OR REPLACE INTO state VALUES(?,?)',(key,json.dumps(state)))
        db.execute('INSERT INTO decisions VALUES(?,?,?,?)',(key,end,digest,json.dumps(decision)))
        # Keep evidence for the review period; active episodes are never pruned here.
        cutoff=now-28*86400
        db.execute('DELETE FROM decisions WHERE end<?',(cutoff,));db.execute('DELETE FROM revisions WHERE end<?',(cutoff,))
        return decision

def report(path,ident=None):
    with connect(path) as db:
        if ident:
            row=db.execute('SELECT payload FROM episodes WHERE id=?',(ident,)).fetchone()
            return json.loads(row[0]) if row else None
        rows=db.execute('SELECT payload FROM episodes ORDER BY first_end DESC LIMIT 50').fetchall()
        latest=db.execute('SELECT payload FROM decisions ORDER BY end DESC LIMIT 1').fetchone()
        return dict(mode=json.loads(latest[0]).get('mode','shadow') if latest else 'shadow',delivery=False,latest=json.loads(latest[0]) if latest else None,
                    totalEpisodes=db.execute('SELECT count(*) FROM episodes').fetchone()[0],episodes=[{k:v for k,v in json.loads(r[0]).items() if k!='windows'} for r in rows])


def read_windows(path,end):
    db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
    try:return {t:json.loads(raw) for t,raw in db.execute('SELECT end,payload FROM samples WHERE end>=? AND end<=? ORDER BY end',(end-3900,end))}
    finally:db.close()
