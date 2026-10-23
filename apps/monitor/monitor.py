"""Local read-only Pons experiment. No keys, RPC or transaction sending."""
import concurrent.futures, datetime, http.server, json, pathlib, threading, time, urllib.request, urllib.parse
import argparse, signal
import wallets
import trade_archive
import market_signals
import activity_alerts
from wallet_activity import summarize_wallets, enrich_names
from decimal import Decimal, InvalidOperation
import re
from market_history import samples, comparison
from storage import begin_attempt, finish_attempt, latest_snapshot, quality, PERIOD
from process_lock import single_writer
STOP = threading.Event()
CACHE = {}
CURRENT_TOKENS = []
CURRENT_HISTORIES = []
HISTORY_ISSUES = {}
REQUESTS = 0
SCAN_DEADLINE = None
MAX_REQUESTS = 300
MAX_SCAN_SECONDS = 180
LOOKBACK = 2100
LAUNCH_PAGES = 15
TRADE_PAGES = 20

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOG = ROOT / '.local' / 'pons-monitor'
BASE = 'https://ponsfamily.com/api/launches'
STATE = {'updated': None, 'error': None, 'loading': True}
LOCK = threading.Lock()

class ScanLimitError(RuntimeError):
    pass

def validate_page(data):
    if not isinstance(data,dict) or not isinstance(data.get('items'),list) or 'nextCursor' not in data:
        raise ValueError('Unexpected pagination response')
    cursor=data['nextCursor']
    if cursor is not None and (not isinstance(cursor,str) or not cursor.strip() or not data['items']):
        raise ValueError('Invalid pagination cursor')
    return data


def read(url):
    global REQUESTS
    if STOP.is_set():
        raise RuntimeError('Collector stopping')
    remaining=SCAN_DEADLINE-time.time() if SCAN_DEADLINE is not None else 15
    if remaining<=0:
        raise TimeoutError('Collection time budget exhausted')
    with LOCK:
        if REQUESTS>=MAX_REQUESTS:
            raise ScanLimitError('Collection request budget exhausted')
        REQUESTS += 1
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=min(15,remaining)) as response:
        data = json.load(response)
    if not isinstance(data.get('items'), list):
        raise ValueError('Unexpected API response')
    return validate_page(data)

def history(token, cutoff, end=None):
    """Resume bounded pagination; only certified ranges may mark a bucket complete."""
    end = int(time.time())-60 if end is None else end
    address=token['address']
    cached=CACHE.get(address)
    if cached and (cached.get('from',float('inf'))>cutoff or cached.get('until',0)>end):
        cached=None
    pending=cached.get('pending') if cached else None
    ranges=[]
    issue='page_limit'
    for _ in range(TRADE_PAGES):
        if pending is None:
            overlap=max(cutoff,cached['until']-300) if cached else cutoff
            pending=dict(cursor=None,seen=[],rows={},overlap=overlap,end=end,oldest=None)
        url=BASE+'/'+address+'?view=trades'
        if pending['cursor']:
            url+='&cursor='+urllib.parse.quote(pending['cursor'])
        try:
            data=validate_page(read(url))
        except (OSError, TimeoutError, ScanLimitError) as exc:
            issue=type(exc).__name__
            break
        stamps=[r['timestamp'] for r in data['items']]
        # A cursor must walk backwards, including ties at page boundaries.
        if stamps and pending['oldest'] is not None and max(stamps)>pending['oldest']:
            issue='page_order';pending=None
            break
        pending['rows'].update({r['id']:r for r in data['items']})
        if stamps:pending['oldest']=min(stamps)
        cursor=data['nextCursor']
        if not cursor or (stamps and min(stamps)<pending['overlap']):
            rows={k:v for k,v in (cached or {}).get('rows',{}).items() if cutoff<=v['timestamp']<pending['overlap']}
            rows.update({k:v for k,v in pending['rows'].items() if v['timestamp']>=cutoff})
            cached=dict(rows=rows,**{'from':cutoff},until=pending['end'])
            CACHE[address]=cached
            pending=None
            if cached['until']>=end:
                HISTORY_ISSUES.pop(address,None)
                return token,list(rows.values()),True
            # Completed an older pass: spend remaining pages on the fresh head.
            continue
        if cursor in pending['seen']:
            issue='cursor_repeated';pending=None
            break
        pending['seen'].append(cursor)
        pending['cursor']=cursor
    rows=dict((cached or {}).get('rows',{}))
    if cached:ranges.append([cached['from'],cached['until']])
    if pending:
        # Replace the overlap only where the new pass actually reached it.
        lower=pending['oldest']+1 if pending['oldest'] is not None else pending['end']
        rows={k:v for k,v in rows.items() if not lower<=v['timestamp']<pending['end']}
        rows.update(pending['rows'])
        if lower<pending['end']:ranges.append([lower,pending['end']])
        base=cached or dict(rows={},**{'from':cutoff},until=cutoff)
        CACHE[address]={**base,'pending':pending}
    elif cached and 'pending' in cached:
        CACHE[address]={k:v for k,v in cached.items() if k!='pending'}
    HISTORY_ISSUES[address]=issue
    # Coverage travels with this scan, never inferred from an unrelated cache.
    token={**token,'tradeCoverage':ranges}
    return token,list(rows.values()),False


def interval_complete(histories, end, launches):
    if not launches:return False
    for token,rows,complete in histories:
        start=max(end-300,token['createdAt'])
        stop=min(end,token['createdAt']+3600)
        if complete or start>=stop:continue
        for a,b in sorted(token.get('tradeCoverage',[])):
            if a<=start: start=max(start,b)
        if start<stop:return False
    return True


def measure(tokens, histories, end):
    events = {}
    completeness={t['address'].lower():complete for t,_,complete in histories}
    for token, rows, _ in histories:
        for row in rows:
            if (row['side'] == 'buy' and row.get('venue') == 'curve'
                and token['createdAt'] <= row['timestamp'] < token['createdAt'] + 3600
                and row['trader'].lower() != token['deployer'].lower()):
                events[(token['address'].lower(), row['id'])] = {**row, 'token': token['address'].lower(), 'symbol': token['symbol'], 'quote': token['quote']['symbol'], 'asset': token['quote'].get('address', token['quote']['symbol']).lower(), 'quoteUsd': token.get('quoteUsd')}
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
    board = []
    for token in tokens:
        if not 0 <= end-token['createdAt'] < 3600:
            continue
        rows = [x for x in events if x['token'] == token['address'].lower() and x['timestamp'] < end]
        recent = [x for x in rows if end-300 <= x['timestamp']]
        previous_rows = [x for x in rows if end-600 <= x['timestamp'] < end-300]
        earlier_wallets = {x['trader'].lower() for x in rows if x['timestamp'] < end-300}
        new_buyers = len({x['trader'].lower() for x in recent}-earlier_wallets) if completeness.get(token['address'].lower()) else None
        board.append(dict(address=token['address'], symbol=token['symbol'], name=token.get('name',token['symbol']),
                          historyComplete=completeness.get(token['address'].lower(),False),
                          ageSeconds=end-token['createdAt'], twitter=social_url((token.get('socials') or {}).get('twitter')),
                          quote=token['quote']['symbol'], quoteAddress=token['quote'].get('address'),
                          recent=purchase_metrics(recent), previous=purchase_metrics(previous_rows),
                          newBuyers=new_buyers, lastBuyAt=max((x['timestamp'] for x in rows),default=None),
                          lifetime=purchase_metrics(rows)))
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
    active_wallets=summarize_wallets(events,end)
    return dict(walletActivity=active_wallets,breadth=breadth,current=current, baseline=baseline, ratios=ratios, candidate=False,
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
    global CURRENT_TOKENS, CURRENT_HISTORIES
    # End one minute behind local clock: reduce indexing/race effects in the live bucket.
    end = int((time.time()-60)//PERIOD)*PERIOD if end is None else end
    cutoff = end-LOOKBACK
    tokens, cursor, list_complete = {}, None, False
    HISTORY_ISSUES.clear()
    list_issue='page_limit'
    seen = set()
    for _ in range(LAUNCH_PAGES):
        url = BASE+'?sort=newest'
        if cursor:
            url += '&cursor='+urllib.parse.quote(str(cursor))
        data = validate_page(read(url))
        for token in data['items']:
            if token['protocol']=='v2' and cutoff-3600 <= token['createdAt'] < end:
                tokens[token['address']] = token
        cursor = data.get('nextCursor')
        if not cursor or (data['items'] and min(x['createdAt'] for x in data['items']) < cutoff-3600):
            list_complete=True
            list_issue=None
            break
        if str(cursor) in seen:
            list_issue='cursor_repeated'
            break
        seen.add(str(cursor))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        histories = list(pool.map(lambda x: history(x, min(cutoff,x['createdAt']), end), tokens.values()))
    for address in list(CACHE):
        if address not in tokens: CACHE.pop(address,None)
    complete = interval_complete(histories,end,list_complete)
    CURRENT_TOKENS=list(tokens.values())
    CURRENT_HISTORIES=histories
    trade_archive.append(LOG/'trades.sqlite3',histories,end,complete)
    result = measure(list(tokens.values()), histories, end)
    enrich_names(result['walletActivity'])
    result.update(updated=time.time(), windowEnd=end, complete=complete, observedTokens=len(tokens),
                  coverage=dict(launches=list_complete,launchIssue=list_issue,tradeIssues=dict(HISTORY_ISSUES),incompleteTokens=[t['address'] for t,_,ok in histories if not ok]),
                  loading=False, error=None, signal=False)
    return result

def run_once(database, cachefile, collector=collect):
    """One bounded collection, atomic sample/attempt/snapshot persistence."""
    global STATE, REQUESTS, SCAN_DEADLINE
    started=time.time()
    attempt=begin_attempt(database, started)
    with LOCK:
        STATE={**STATE,'refreshing':True}
        REQUESTS=0
        SCAN_DEADLINE=started+MAX_SCAN_SECONDS
    try:
        result=collector()
        end=int(result['windowEnd'])
        observations=[]
        # Up to seven closed buckets from THIS scan, including corrections to recent
        # complete buckets. Never reconstruct partial rows from an older good cache.
        for bucket in range(end-LOOKBACK+PERIOD, end+1, PERIOD):
            aligned=measure(CURRENT_TOKENS, CURRENT_HISTORIES, bucket)
            aligned.update(windowEnd=bucket, complete=interval_complete(CURRENT_HISTORIES,bucket,result['coverage']['launches']), coverage=result['coverage'], collectedAt=time.time())
            observations.append((bucket,aligned))
        old=dict(samples(database,summary=True))
        merged=dict(old)
        for bucket, value in observations:
            if not old.get(bucket,{}).get('complete') or value['complete']:
                merged[bucket]=value
        result['market']=comparison(result,sorted(merged.items()))
        # Load full saved payloads only for the visible buckets needing fallback.
        from storage import complete_windows
        saved=complete_windows(database,[t for t,v in observations if not v['complete']])
        result['intervals']=[dict(saved.get(bucket,value),windowEnd=bucket) for bucket,value in observations]
        latest=result['intervals'][-1]
        if latest['complete']:
            for key in ('current','board','volumes','breadth','walletActivity','coverage','complete'):
                if key in latest:result[key]=latest[key]
        result['chart']=[x['current'] for x in result['intervals']]
        result['scanSeconds']=round(time.time()-started,1)
        result['requests']=REQUESTS
        result['refreshing']=False
        result['signal']=False
        result['nextScanAt']=max(time.time()+10,started+PERIOD)
        details=dict(requests=REQUESTS, windowEnd=end, coverage=result['coverage'],
                     repaired=sum(t in old and not old[t].get('complete') and x['complete'] for t,x in observations),
                     filled=sum(t not in old for t,_ in observations),
                     pageLimits=dict(launches=LAUNCH_PAGES,tradesPerToken=TRADE_PAGES))
        finish_attempt(database,attempt,time.time(),'complete' if result['complete'] else 'partial',details,observations,result)
        result['collection']=quality(database,end)
        # Signal failures never discard a successful market collection.
        try:
            history=market_signals.read_windows(database,end)
            activity_alerts.record(database.with_name('activity-alerts.sqlite3'),history,end,time.time())
        except Exception:
            result['marketSignals']=dict(mode='shadow',delivery=False,status='unavailable')
        # Cache is an optimisation only: a failed cache write does not invalidate DB history.
        try:
            temp=cachefile.with_suffix('.tmp')
            temp.write_text(json.dumps(CACHE),encoding='utf-8');temp.replace(cachefile)
        except OSError:
            result['cacheWarning']='Cache could not be saved; next scan may refetch history'
        with LOCK:
            STATE=result
        return result
    except Exception as exc:
        # Error text can contain URLs. Expose a bounded category, never raw credentials.
        category=type(exc).__name__
        details=dict(error=category,requests=REQUESTS)
        finish_attempt(database,attempt,time.time(),'error',details)
        report=quality(database,int((time.time()-60)//PERIOD)*PERIOD)
        with LOCK:
            STATE={**STATE,'error':category,'loading':False,'signal':False,'refreshing':False,
                   'collection':report,'nextScanAt':max(time.time()+10,started+PERIOD)}
        return dict(STATE)
    finally:
        SCAN_DEADLINE=None


def worker():
    global STATE
    LOG.mkdir(parents=True, exist_ok=True)
    database=LOG/'market.sqlite3'
    cachefile=LOG/'trade-cache.json'
    try:
        cached=json.loads(cachefile.read_text(encoding='utf-8'))
        if isinstance(cached,dict):
            for address, value in cached.items():
                if (isinstance(value,dict) and isinstance(value.get('rows'),dict)
                    and isinstance(value.get('from'),(int,float)) and isinstance(value.get('until'),(int,float))
                    and value['from']<=value['until']):
                    CACHE[address]=value
    except (OSError,ValueError): pass
    try:
        restored=latest_snapshot(database)
        if restored:
            restored['collection']=quality(database,int((time.time()-60)//PERIOD)*PERIOD)
            with LOCK: STATE={**restored,'refreshing':True,'signal':False}
    except Exception:
        with LOCK: STATE={**STATE,'error':'StorageUnavailable','loading':False,'refreshing':False,'signal':False}
    while not STOP.is_set():
        started=time.time()
        try:
            run_once(database,cachefile)
        except Exception:
            # A storage outage must not kill the only collector thread silently.
            with LOCK: STATE={**STATE,'error':'StorageUnavailable','loading':False,'refreshing':False,'signal':False}
        STOP.wait(max(10,PERIOD-(time.time()-started)))

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/api/refresh':
            self.send_error(404);return
        if self.headers.get('X-Monitor-Refresh') != '1':
            self.send_error(403);return
        # Compatibility for old clients: requesting a snapshot never schedules Pons work.
        self.send_response(202);self.end_headers();self.wfile.write(b'{"collectionScheduled":false}')

    def do_GET(self):
        parsed=urllib.parse.urlsplit(self.path)
        if parsed.path in ('/api/activity-events','/api/interval'):
            if parsed.path=='/api/activity-events':
                data=activity_alerts.feed(LOG/'activity-alerts.sqlite3');data['events']=[e for e in data['events'] if 0<=time.time()-e['windowEnd']<=900]
            else:
                try:
                    end=int(urllib.parse.parse_qs(parsed.query).get('end',[''])[0])
                    if end<=0 or end%300:raise ValueError()
                except ValueError:self.send_error(400);return
                data=activity_alerts.snapshot(LOG/'activity-alerts.sqlite3',end)
                if data is None:self.send_error(404);return
            body=json.dumps(data).encode();kind='application/json'
        elif parsed.path in ('/api/market-signals','/api/market-signal'):
            ident=urllib.parse.parse_qs(parsed.query).get('id',[None])[0]
            if parsed.path=='/api/market-signal' and not re.fullmatch(r'[0-9a-f]{24}',ident or ''):
                self.send_error(400);return
            data=market_signals.report(LOG/'market-signals.sqlite3',ident if parsed.path=='/api/market-signal' else None)
            if data is None:self.send_error(404);return
            body=json.dumps(data).encode();kind='application/json'
        elif parsed.path in ('/api/active-wallets','/api/observed-trades'):
            try:
                query=urllib.parse.parse_qs(parsed.query)
                if parsed.path=='/api/observed-trades':
                    after=int(query['after'][0]) if 'after' in query else None
                    data=trade_archive.feed(LOG/'trades.sqlite3',after)
                else:
                    with LOCK:end=STATE.get('windowEnd')
                    if not end:raise ValueError('No snapshot')
                    data=trade_archive.ranking(LOG/'trades.sqlite3',int(end),int(query.get('minutes',['5'])[0]))
                    enrich_names(data['walletActivity'])
                body=json.dumps(data).encode();kind='application/json'
            except ValueError:self.send_error(400);return
        elif parsed.path == '/api/wallet':
            try:
                wallet=wallets.address(urllib.parse.parse_qs(parsed.query).get('address',[''])[0])
                data=wallets.snapshot(LOG/'wallets.sqlite3',wallet)
            except ValueError:
                self.send_error(400);return
            except Exception:
                self.send_error(503);return
            body=json.dumps(data).encode();kind='application/json'
        elif parsed.path in ('/imgs/pw_eye.png','/imgs/pw_mascot.png'):
            body=(pathlib.Path(__file__).parent / parsed.path.lstrip('/')).read_bytes()
            kind='image/png'
        elif parsed.path in ('/ui.css','/ui.js','/tokens.js','/wallet-ui.js','/access.js','/alerts.js','/sw.js','/signals.js','/notifications.js'):
            body=pathlib.Path(__file__).with_name(parsed.path[1:]).read_bytes()
            kind='text/css; charset=utf-8' if parsed.path.endswith('.css') else 'text/javascript; charset=utf-8'
        elif parsed.path == '/signals':
            body=pathlib.Path(__file__).with_name('signals.html').read_bytes();kind='text/html; charset=utf-8'
        elif parsed.path == '/wallets':
            body=pathlib.Path(__file__).with_name('wallets.html').read_bytes();kind='text/html; charset=utf-8'
        elif self.path == '/api/status':
            with LOCK:
                data=dict(STATE)
            data['stale'] = not data.get('windowEnd') or time.time()-data['windowEnd'] > 660
            if data['stale'] or data.get('error'):
                data['signal']=False
            body=json.dumps(data).encode();kind='application/json'
        elif parsed.path == '/':
            body=pathlib.Path(__file__).with_name('index.html').read_bytes();kind='text/html; charset=utf-8'
        else:
            self.send_error(404);return
        self.send_response(200)
        self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
    def log_message(self, *args):
        pass

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=pathlib.Path,default=LOG)
    parser.add_argument('--port',type=int,default=4196)
    args=parser.parse_args()
    LOG=args.data_dir.resolve()
    with single_writer(LOG):
        server=http.server.ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
        thread=threading.Thread(target=worker,daemon=True);thread.start()
        print(f'Pons monitor http://127.0.0.1:{args.port}/',flush=True)
        def terminate(signum, frame): raise KeyboardInterrupt
        signal.signal(signal.SIGTERM,terminate)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
        finally:
            STOP.set();server.server_close();thread.join(timeout=20)
