"""Local read-only Pons experiment. No keys, RPC or transaction sending."""
import concurrent.futures, datetime, http.server, json, pathlib, threading, time, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOG = ROOT / '.local' / 'pons-monitor'
BASE = 'https://ponsfamily.com/api/launches'
STATE = {'updated': None, 'error': None, 'loading': True}
LOCK = threading.Lock()

def read(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        data = json.load(response)
    if not isinstance(data.get('items'), list):
        raise ValueError('Unexpected API response')
    return data

def history(token, cutoff):
    rows, cursor = {}, None
    for _ in range(20):
        url = BASE + '/' + token['address'] + '?view=trades'
        if cursor:
            url += '&cursor=' + urllib.parse.quote(str(cursor))
        data = read(url)
        for row in data['items']:
            rows[row['id']] = row
        cursor = data.get('nextCursor')
        if not cursor or (data['items'] and min(x['timestamp'] for x in data['items']) < cutoff):
            return token, list(rows.values()), True
    return token, list(rows.values()), False

def measure(tokens, histories, end):
    events = {}
    for token, rows, _ in histories:
        for row in rows:
            if (row['side'] == 'buy' and row.get('venue') == 'curve'
                and token['createdAt'] <= row['timestamp'] < token['createdAt'] + 3600
                and row['trader'].lower() != token['deployer'].lower()):
                events[(token['address'], row['id'])] = {**row, 'token': token['address'], 'symbol': token['symbol'], 'quote': token['quote']['symbol']}
    events = list(events.values())
    def window(a, b):
        rows = [x for x in events if a <= x['timestamp'] < b]
        return dict(buys=len(rows), buyers=len({x['trader'].lower() for x in rows}), tokens=len({x['token'] for x in rows}),
                    launches=sum(a <= x['createdAt'] < b for x in tokens),
                    usdg=sum(x['quoteAmount'] for x in rows if x['quote'] == 'USDG'))
    current = window(end-300, end)
    previous = [window(end-300*(i+2), end-300*(i+1)) for i in range(6)]
    baseline = {k: sum(x[k] for x in previous)/6 for k in current}
    ratios = {k: current[k]/baseline[k] if baseline[k] else None for k in ('buys','buyers')}
    candidate = (current['buys'] >= 10 and current['buyers'] >= 8 and current['tokens'] >= 3
                 and all(ratios[k] is not None and ratios[k] >= 1.8 for k in ratios))
    recent = [x for x in events if end-300 <= x['timestamp'] < end]
    board = []
    for address in {x['token'] for x in recent}:
        rows = [x for x in recent if x['token'] == address]
        board.append(dict(address=address, symbol=rows[0]['symbol'], buys=len(rows), buyers=len({x['trader'].lower() for x in rows})))
    return dict(current=current, baseline=baseline, ratios=ratios, candidate=candidate,
                board=sorted(board, key=lambda x:x['buyers'], reverse=True)[:12],
                chart=[*reversed(previous), current], latestTrade=max((x['timestamp'] for x in events), default=None))

def collect():
    # End one minute behind local clock: reduce indexing/race effects in the live bucket.
    end = int(time.time())-60
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
        histories = list(pool.map(lambda x: history(x, cutoff), tokens.values()))
    complete = list_complete and all(x[2] for x in histories)
    result = measure(list(tokens.values()), histories, end)
    result.update(updated=time.time(), windowEnd=end, complete=complete, observedTokens=len(tokens),
                  loading=False, error=None, signal=result['candidate'] and complete)
    return result

def worker():
    global STATE
    LOG.mkdir(parents=True, exist_ok=True)
    while True:
        started=time.time()
        try:
            result=collect()
            result['scanSeconds']=round(time.time()-started,1)
            # Slow collection must never show a fresh actionable signal.
            result['signal'] = result['signal'] and time.time()-result['windowEnd'] < 240
            with LOCK:
                STATE=result
            with (LOG/'observations.jsonl').open('a', encoding='utf-8') as f:
                f.write(json.dumps(result)+'\n')
        except Exception as exc:
            with LOCK:
                STATE={**STATE, 'error':str(exc), 'loading':False, 'signal':False}
        time.sleep(max(10,60-(time.time()-started)))

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/status':
            with LOCK:
                data=dict(STATE)
            data['stale'] = not data.get('windowEnd') or time.time()-data['windowEnd'] > 240
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
