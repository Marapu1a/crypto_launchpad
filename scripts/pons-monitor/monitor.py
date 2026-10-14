"""Local read-only Pons experiment. No keys, RPC or transaction sending."""
import concurrent.futures, datetime, http.server, json, pathlib, threading, time, urllib.request, urllib.parse
from decimal import Decimal, InvalidOperation
import re
from market_history import save_sample, samples, comparison
WAKE = threading.Event()
CACHE = {}
CURRENT_TOKENS = []
REQUESTS = 0

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOG = ROOT / '.local' / 'pons-monitor'
BASE = 'https://ponsfamily.com/api/launches'
STATE = {'updated': None, 'error': None, 'loading': True}
LOCK = threading.Lock()

def read(url):
    global REQUESTS
    with LOCK: REQUESTS += 1
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        data = json.load(response)
    if not isinstance(data.get('items'), list):
        raise ValueError('Unexpected API response')
    return data

def history(token, cutoff):
    cached = CACHE.get(token["address"])
    overlap = max(cutoff, cached["until"]-300) if cached else cutoff
    rows, cursor = dict(cached["rows"]) if cached else {}, None
    for _ in range(20):
        url = BASE + '/' + token['address'] + '?view=trades'
        if cursor:
            url += '&cursor=' + urllib.parse.quote(str(cursor))
        data = read(url)
        for row in data['items']:
            rows[row['id']] = row
        cursor = data.get('nextCursor')
        if not cursor or (data['items'] and min(x['timestamp'] for x in data['items']) < overlap):
            rows = {k:v for k,v in rows.items() if v['timestamp'] >= cutoff}
            CACHE[token['address']] = dict(rows=rows, until=int(time.time())-60)
            return token, list(rows.values()), True
    return token, list(rows.values()), False

def measure(tokens, histories, end):
    events = {}
    completeness={t['address'].lower():complete for t,_,complete in histories}
    for token, rows, _ in histories:
        for row in rows:
            if (row['side'] == 'buy' and row.get('venue') == 'curve'
                and token['createdAt'] <= row['timestamp'] < token['createdAt'] + 3600
                and row['trader'].lower() != token['deployer'].lower()):
                events[(token['address'].lower(), row['id'])] = {**row, 'token': token['address'].lower(), 'symbol': token['symbol'], 'quote': token['quote']['symbol'], 'asset': token['quote'].get('address', token['quote']['symbol']).lower()}
    events = list(events.values())
    def window(a, b):
        rows = [x for x in events if a <= x['timestamp'] < b]
        return dict(buys=len(rows), buyers=len({x['trader'].lower() for x in rows}), tokens=len({x['token'] for x in rows}),
                    launches=sum(a <= x['createdAt'] < b for x in tokens),
                    usdg=purchase_metrics([x for x in rows if x['quote'] == 'USDG'])['volume'])
    current = window(end-300, end)
    previous = [window(end-300*(i+2), end-300*(i+1)) for i in range(6)]
    for bucket in [current,*previous]:
        bucket['usdg']=float(bucket['usdg']) if bucket['usdg'] is not None else None
    baseline = {k: sum(x[k] for x in previous)/6 if all(x[k] is not None for x in previous) else None for k in current}
    ratios = {k: current[k]/baseline[k] if baseline[k] else None for k in ('buys','buyers')}
    candidate = (current['buys'] >= 10 and current['buyers'] >= 8 and current['tokens'] >= 3
                 and all(ratios[k] is not None and ratios[k] >= 1.8 for k in ratios))
    board = []
    for token in tokens:
        if not 0 <= end-token['createdAt'] < 3600:
            continue
        rows = [x for x in events if x['token'] == token['address'].lower() and x['timestamp'] < end]
        recent = [x for x in rows if end-300 <= x['timestamp']]
        board.append(dict(address=token['address'], symbol=token['symbol'], name=token.get('name',token['symbol']),
                          historyComplete=completeness.get(token['address'].lower(),False),
                          ageSeconds=end-token['createdAt'], twitter=social_url((token.get('socials') or {}).get('twitter')),
                          quote=token['quote']['symbol'], quoteAddress=token['quote'].get('address'),
                          recent=purchase_metrics(recent), lifetime=purchase_metrics(rows)))
    volumes = {}
    for row in events:
        if end-300 <= row['timestamp'] < end:
            bucket=volumes.setdefault(row['asset'],dict(asset=row['asset'],symbol=row['quote'],rows=[]))
            bucket['rows'].append(row)
    volume_totals=[dict(asset=x['asset'],symbol=x['symbol'],**purchase_metrics(x['rows'])) for x in volumes.values()]
    wallets={}
    for row in events:
        if end-300 <= row['timestamp'] < end:
            wallets.setdefault(row['token'],set()).add(row['trader'].lower())
    breadth=dict(qualifiedTokens=sum(len(v)>=3 for v in wallets.values()), leaderPct=round(100*max((len(v) for v in wallets.values()),default=0)/current['buyers'],2) if current['buyers'] else 0, buysPerWallet=current['buys']/current['buyers'] if current['buyers'] else 0)
    return dict(breadth=breadth,current=current, baseline=baseline, ratios=ratios, candidate=candidate,
                schema='pons-monitor-v2', volumes=volume_totals,
                board=sorted(board, key=lambda x:(-x['recent']['buyers'],-x['lifetime']['buyers'],x['address'])),
                chart=[*reversed(previous), current], latestTrade=max((x['timestamp'] for x in events), default=None))


def social_url(value):
    if not isinstance(value,str):return None
    try:
        url=urllib.parse.urlsplit(value.strip())
        if url.scheme!='https' or url.hostname not in ('x.com','www.x.com','twitter.com','www.twitter.com') or url.username or url.password or url.port not in (None,443):return None
        return urllib.parse.urlunsplit(('https',url.hostname,url.path,url.query,''))
    except ValueError:return None


def purchase_metrics(rows):
    wallets={}; amounts=[]; missing=0; largest=None
    for row in rows:
        wallet=row['trader'].lower()
        wallets.setdefault(wallet,Decimal(0))
        try:
            amount=Decimal(str(row.get('quoteAmount')))
            if not amount.is_finite() or amount<0:raise InvalidOperation
        except (InvalidOperation,ValueError):
            missing+=1;continue
        amounts.append(amount);wallets[wallet]+=amount
        if largest is None or amount>largest[0]:largest=(amount,row.get('txHash'))
    amounts.sort();total=sum(amounts,Decimal(0));count=len(amounts)
    median=(amounts[(count-1)//2]+amounts[count//2])/2 if count else None
    # A partial sum must never masquerade as the whole trading volume.
    return dict(buys=len(rows),buyers=len(wallets),missingAmounts=missing,
                volume=str(total) if not missing else None,
                maximum=str(largest[0]) if largest and not missing else None,
                maximumTx=largest[1] if largest and not missing and re.fullmatch(r'0x[0-9a-fA-F]{64}',str(largest[1])) else None,
                median=str(median) if median is not None and not missing else None,
                top3Pct=float(sum(sorted(wallets.values(),reverse=True)[:3],Decimal(0))/total*100) if total and not missing else None)

def collect(end=None):
    global CURRENT_TOKENS
    # End one minute behind local clock: reduce indexing/race effects in the live bucket.
    end = int(time.time())-60 if end is None else end
    cutoff = end-2100
    tokens, cursor, list_complete = {}, None, False
    for _ in range(15):
        url = BASE+'?sort=newest'
        if cursor:
            url += '&cursor='+urllib.parse.quote(str(cursor))
        data = read(url)
        for token in data['items']:
            if token['protocol']=='v2' and cutoff-3600 <= token['createdAt'] < end:
                tokens[token['address']] = token
        cursor = data.get('nextCursor')
        if not cursor or (data['items'] and min(x['createdAt'] for x in data['items']) < cutoff-3600):
            list_complete=True
            break
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        histories = list(pool.map(lambda x: history(x, min(cutoff,x['createdAt']) if end-x['createdAt']<3600 else cutoff), tokens.values()))
    for address in list(CACHE):
        if address not in tokens: CACHE.pop(address,None)
    complete = list_complete and all(x[2] for x in histories)
    CURRENT_TOKENS=list(tokens.values())
    result = measure(list(tokens.values()), histories, end)
    result.update(updated=time.time(), windowEnd=end, complete=complete, observedTokens=len(tokens),
                  coverage=dict(launches=list_complete,incompleteTokens=[t['address'] for t,_,ok in histories if not ok]),
                  loading=False, error=None, signal=result['candidate'] and complete)
    return result

def worker():
    global STATE, REQUESTS
    LOG.mkdir(parents=True, exist_ok=True)
    database=LOG/'market.sqlite3'
    cachefile=LOG/'trade-cache.json'
    try:
        CACHE.update(json.loads(cachefile.read_text(encoding='utf-8')))
    except (OSError,ValueError): pass
    last_bucket=None
    while True:
        started=time.time()
        with LOCK:
            STATE={**STATE,'refreshing':True}
            REQUESTS=0
        try:
            result=collect()
            bucket=int(result['windowEnd']//300)*300
            if bucket!=last_bucket:
                # The full 35-minute scan covers this closed interval. Reuse collected rows.
                tokens=[t for t in CURRENT_TOKENS]
                histories=[(t,list(CACHE.get(t['address'],{}).get('rows',{}).values()),t['address'] in CACHE) for t in tokens]
                aligned=measure(tokens,histories,bucket)
                aligned.update(windowEnd=bucket,complete=result['complete'])
                save_sample(database,bucket,aligned)
                if aligned['complete']: last_bucket=bucket
            temp=cachefile.with_suffix('.tmp')
            temp.write_text(json.dumps(CACHE),encoding='utf-8');temp.replace(cachefile)
            result['market']=comparison(result,samples(database))
            result['scanSeconds']=round(time.time()-started,1)
            result['requests']=REQUESTS
            result['refreshing']=False
            result['signal']=False
            with LOCK: STATE=result
        except Exception as exc:
            with LOCK: STATE={**STATE,'error':str(exc),'loading':False,'signal':False,'refreshing':False}
        WAKE.wait(max(10,300-(time.time()-started)))
        WAKE.clear()

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/api/refresh':
            self.send_error(404);return
        if self.headers.get('X-Monitor-Refresh') != '1':
            self.send_error(403);return
        with LOCK:
            busy=STATE.get('refreshing',False)
            recent=time.time()-(STATE.get('updated') or 0)<15
            if not busy and not recent:
                STATE['refreshing']=True
                WAKE.set()
        self.send_response(202);self.end_headers();self.wfile.write(b'{}')

    def do_GET(self):
        if self.path == '/api/status':
            with LOCK:
                data=dict(STATE)
            data['stale'] = not data.get('windowEnd') or time.time()-data['windowEnd'] > 660
            if data['stale'] or data.get('error'):
                data['signal']=False
            body=json.dumps(data).encode();kind='application/json'
        elif self.path == '/':
            body=pathlib.Path(__file__).with_name('index.html').read_bytes();kind='text/html; charset=utf-8'
        else:
            self.send_error(404);return
        self.send_response(200)
        self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
    def log_message(self, *args):
        pass

if __name__ == '__main__':
    server=http.server.ThreadingHTTPServer(('127.0.0.1',4196),Handler)
    threading.Thread(target=worker,daemon=True).start()
    print('Pons monitor http://127.0.0.1:4196/',flush=True)
    server.serve_forever()
