"""Pons-authoritative purchase journal. No RPC, keys, signing or production writes."""
import argparse
import datetime
import hashlib
import html
import json
import pathlib
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation, localcontext

BASE = 'https://ponsfamily.com/api/launches/'
ADDRESS = re.compile(r'0x[0-9a-fA-F]{40}')
HASH = re.compile(r'0x[0-9a-fA-F]{64}')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def units(value, decimals):
    # JSON decimals are decoded as strings, never binary floats.
    if isinstance(value, (float, bool)) or not isinstance(value, (str, int)):
        raise ValueError('Amount must be lossless decimal')
    if len(str(value)) > 100:
        raise ValueError('Amount too long')
    try:
        with localcontext() as ctx:
            ctx.prec = 120
            amount = Decimal(value)
            if not amount.is_finite() or amount < 0 or amount > Decimal(2)**256:
                raise ValueError('Invalid amount')
            raw = amount * 10**decimals
            if raw != raw.to_integral_value() or raw >= Decimal(2)**256:
                raise ValueError('Amount precision/range unsupported')
            return int(raw)
    except InvalidOperation as exc:
        raise ValueError('Invalid amount') from exc


def validate_profile(p):
    required = {'project', 'token', 'quote', 'decimals', 'threshold', 'excludedWallets', 'venues'}
    if set(p) != required or not re.fullmatch(r'[a-z0-9_-]{1,64}', p['project']):
        raise ValueError('Invalid profile')
    if not all(isinstance(a, str) and ADDRESS.fullmatch(a) for a in [p['token'], p['quote'], *p['excludedWallets']]):
        raise ValueError('Invalid profile address')
    if type(p['decimals']) is not int or not 0 <= p['decimals'] <= 18:
        raise ValueError('Invalid decimals')
    if p['venues'] != ['curve']:
        raise ValueError('Only reviewed curve venue is enabled')
    if units(p['threshold'], p['decimals']) <= 0:
        raise ValueError('Invalid threshold')
    return p


def normalize(row, profile):
    tx = row.get('txHash', '')
    identity = row.get('id', '')
    wallet = row.get('trader', '')
    if not isinstance(tx, str) or not HASH.fullmatch(tx):
        raise ValueError('Invalid transaction hash')
    if not isinstance(identity, str) or not re.fullmatch(re.escape(tx) + r':\d+', identity, re.I):
        raise ValueError('Invalid trade identity')
    if not isinstance(wallet, str) or not ADDRESS.fullmatch(wallet) or int(wallet, 16) == 0:
        raise ValueError('Invalid trader')
    if type(row.get('timestamp')) is not int or row['timestamp'] <= 0:
        raise ValueError('Invalid timestamp')
    if row.get('side') not in ('buy', 'sell') or not isinstance(row.get('venue'), str):
        raise ValueError('Invalid trade type')
    raw = units(row.get('quoteAmount'), profile['decimals'])
    reason = 'purchase'
    if row['side'] == 'sell':
        reason = 'sale-no-ticket-change'
    elif row['venue'] not in profile['venues']:
        reason = 'unsupported-venue'
    elif wallet.lower() in {a.lower() for a in profile['excludedWallets']}:
        reason = 'excluded-wallet'
    elif raw == 0:
        reason = 'zero-amount'
    return dict(id=tx.lower()+':'+str(int(identity.split(':')[1])), txHash=tx.lower(),
                trader=wallet.lower(), timestamp=row['timestamp'], side=row['side'],
                venue=row['venue'], quoteRaw=str(raw), decision=reason)


class Journal:
    def __init__(self, path):
        pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = open(str(path)+'.lock', 'a+b')
        try:
            if os.fstat(self.lock.fileno()).st_size == 0:
                self.lock.write(b'0'); self.lock.flush()
            self.lock.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock.close()
            raise ValueError('Accounting journal is already in use')
        self.db = sqlite3.connect(path, timeout=10)
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS projects(project TEXT PRIMARY KEY, profile TEXT NOT NULL,
          checked INTEGER, full_checked INTEGER, fingerprint TEXT, status TEXT NOT NULL, error TEXT);
        CREATE TABLE IF NOT EXISTS trades(project TEXT, id TEXT, normalized TEXT NOT NULL,
          raw TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY(project,id));
        CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, project TEXT, at INTEGER,
          status TEXT, requests INTEGER, detail TEXT);
        CREATE TABLE IF NOT EXISTS pages(run INTEGER, page INTEGER, body TEXT,
          PRIMARY KEY(run,page));
        CREATE TABLE IF NOT EXISTS reviews(project TEXT, id TEXT, old TEXT, proposed TEXT,
          at INTEGER, UNIQUE(project,id,proposed));
        ''')

    def close(self):
        self.db.close()
        self.lock.close()

    def register(self, profile):
        validate_profile(profile)
        stored = self.db.execute('SELECT profile FROM projects WHERE project=?', (profile['project'],)).fetchone()
        if stored and stored[0] != encode(profile):
            raise ValueError('Profile changed: explicit migration required')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO projects(project,profile,status) VALUES(?,?,?)',
                            (profile['project'], encode(profile), 'not-synced'))

    def report(self, project):
        row = self.db.execute('SELECT profile,checked,full_checked,status,error FROM projects WHERE project=?', (project,)).fetchone()
        if not row:
            raise ValueError('Unknown project')
        p = json.loads(row[0]); threshold = units(p['threshold'], p['decimals'])
        entries = [json.loads(x[0]) for x in self.db.execute('SELECT normalized FROM trades WHERE project=?', (project,))]
        entries.sort(key=lambda x: (x['timestamp'], x['txHash'], int(x['id'].split(':')[1])))
        wallets = {}; activity = []
        for event in entries:
            record = dict(event, addedTickets='0', explorer='https://robinhoodchain.blockscout.com/tx/'+event['txHash'])
            if event['decision'] == 'purchase':
                w = wallets.setdefault(event['trader'], dict(amountRaw='0', tickets='0', remainderRaw='0'))
                total = int(w['amountRaw']) + int(event['quoteRaw'])
                record.update(addedTickets=str(total//threshold-int(w['tickets'])), remainderRaw=str(total % threshold))
                w.update(amountRaw=str(total), tickets=str(total//threshold), remainderRaw=str(total % threshold))
            activity.append(record)
        reviews = self.db.execute('SELECT count(*) FROM reviews WHERE project=?', (project,)).fetchone()[0]
        return dict(schema='pons-purchase-accounting-v1', source='Pons API', mode='local-comparison',
                    ticketBasis='pons-quoteAmount', profile=p, status=row[3], error=row[4],
                    checkedAt=row[1], fullHistoryCheckedAt=row[2], reviewCount=reviews,
                    tradeCount=len(entries), totalTickets=str(sum(int(w['tickets']) for w in wallets.values())),
                    wallets=wallets, activity=activity, executionEnabled=False,
                    note='Gross accumulated tickets; existing consumed/frozen tickets are not migrated.')


def http_get(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'PonsAccounting/1.0'})
    with urllib.request.urlopen(req, timeout=20) as response:
        body = response.read(4_000_001)
    if len(body) > 4_000_000:
        raise ValueError('Oversized API response')
    return json.loads(body.decode(), parse_float=str,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Invalid JSON number')))


def metadata(value, p):
    if not isinstance(value, dict) or str(value.get('address', '')).lower() != p['token'].lower():
        raise ValueError('Wrong token metadata')
    q = value.get('quote') or {}
    if str(q.get('address', '')).lower() != p['quote'].lower() or q.get('decimals') != p['decimals']:
        raise ValueError('Quote asset changed')
    if type(value.get('tradeCount')) is not int or value['tradeCount'] < 0:
        raise ValueError('Missing trade count')
    if value.get('stage') != 'curve':
        raise ValueError('Graduated/unknown stage requires a reviewed policy')
    return digest({k: value.get(k) for k in ('address', 'tradeCount', 'lastTradeAt', 'stage', 'quote')})


def sync(journal, p, get=http_get, now=None, max_pages=20, full_every=21600, force=False):
    """Bounded full walk on changes; quiet polls read metadata only. No chain scans.

    A full walk commits atomically. Interrupted walks restart at page one; the
    previous successful journal is never replaced by a partial result.
    """
    journal.register(p)
    now = int(time.time()) if now is None else now
    if not 1 <= max_pages <= 200:
        raise ValueError('Invalid page budget')
    db = journal.db; project = p['project']; requests = 0
    with db:
        run = db.execute('INSERT INTO runs(project,at,status,requests) VALUES(?,?,?,0)', (project, now, 'running')).lastrowid
    def read(url, page):
        nonlocal requests
        requests += 1
        value = get(url)
        with db:
            db.execute('INSERT INTO pages VALUES(?,?,?)', (run, page, encode(value)))
        return value
    try:
        base = BASE + p['token'].lower()
        before = read(base, -1); fp = metadata(before, p)
        prev = db.execute('SELECT fingerprint,full_checked FROM projects WHERE project=?', (project,)).fetchone()
        reviews = db.execute('SELECT count(*) FROM reviews WHERE project=?', (project,)).fetchone()[0]
        unsupported = any(json.loads(row[0])['decision'] == 'unsupported-venue' for row in
                          db.execute('SELECT normalized FROM trades WHERE project=?', (project,)))
        if not force and not reviews and not unsupported and prev[0] == fp and prev[1] is not None and 0 <= now-prev[1] < full_every:
            with db:
                db.execute("UPDATE projects SET checked=?,status='current',error=NULL WHERE project=?", (now, project))
                db.execute("UPDATE runs SET status='unchanged',requests=? WHERE id=?", (requests, run))
            return dict(status='unchanged', requests=requests, run=run)
        cursor = None; seen = set(); found = {}
        for page in range(max_pages):
            url = base + '?view=trades' + ('&cursor='+urllib.parse.quote(cursor, safe='') if cursor else '')
            data = read(url, page)
            if not isinstance(data, dict) or not isinstance(data.get('items'), list) or 'nextCursor' not in data:
                raise ValueError('Invalid trades page')
            for raw in data['items']:
                value = normalize(raw, p)
                if value['timestamp'] > now+60:
                    raise ValueError('Future trade timestamp')
                key = value['id']
                if key in found and found[key][0] != value:
                    raise ValueError('Conflicting duplicate trade')
                found[key] = (value, raw)
            cursor = data['nextCursor']
            if cursor is None:
                break
            if not isinstance(cursor, str) or not cursor or len(cursor) > 1000 or cursor in seen or not data['items']:
                raise ValueError('Broken pagination')
            seen.add(cursor)
        else:
            raise ValueError('Page budget reached; history incomplete')
        after = read(base, max_pages)
        if metadata(after, p) != fp or len(found) != before['tradeCount']:
            raise ValueError('History changed or trade count mismatch; retry')
        old = dict(db.execute('SELECT id,normalized FROM trades WHERE project=?', (project,)))
        changes = [(key, value, encode(found[key][0]) if key in found else 'null')
                   for key, value in old.items() if key not in found or value != encode(found[key][0])]
        pending = any(value['decision'] == 'unsupported-venue' for value, _ in found.values())
        with db:
            for key, value, proposed in changes:
                db.execute('INSERT OR IGNORE INTO reviews VALUES(?,?,?,?,?)', (project, key, value, proposed, now))
            if changes or reviews:
                status = 'review-required'
            else:
                for key, (value, raw) in found.items():
                    db.execute('INSERT OR IGNORE INTO trades VALUES(?,?,?,?,?)', (project, key, encode(value), encode(raw), now))
                status = 'review-required' if pending else 'current'
            db.execute('UPDATE projects SET checked=?,full_checked=?,fingerprint=?,status=?,error=NULL WHERE project=?',
                       (now, now, fp, status, project))
            db.execute('UPDATE runs SET status=?,requests=?,detail=? WHERE id=?', (status, requests, encode(dict(rows=len(found), changes=len(changes))), run))
        return dict(status=status, requests=requests, rows=len(found), changes=len(changes), run=run)
    except Exception as exc:
        # No endpoint secrets or raw network exception strings in public reports.
        message = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        with db:
            db.execute("UPDATE projects SET status='unavailable',error=? WHERE project=?", (message, project))
            db.execute("UPDATE runs SET status='failed',requests=?,detail=? WHERE id=?", (requests, message, run))
        return dict(status='unavailable', error=message, requests=requests, run=run)


def render_report(report):
    esc = lambda value: html.escape(str(value), quote=True)
    p = report['profile']
    def amount(value):
        with localcontext() as ctx:
            ctx.prec = 120
            return format(Decimal(value)/10**p['decimals'], 'f')
    labels = {'purchase': 'Покупка', 'sale-no-ticket-change': 'Продажа — без изменения билетов',
              'excluded-wallet': 'Исключённый адрес', 'unsupported-venue': 'Площадка требует проверки', 'zero-amount': 'Нулевая сумма'}
    date = lambda ts: datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime('%d.%m.%Y %H:%M:%S UTC') if ts else '—'
    rows = ''.join('<tr><td>'+esc(date(e['timestamp']))+'</td><td><a href="'+esc(e['explorer'])+'">'+esc(e['id'][:12])+'…</a></td><td>'+esc(e['trader'])+'</td><td>'+esc(amount(e['quoteRaw']))+'</td><td>'+esc(labels[e['decision']])+'</td><td>+'+esc(e['addedTickets'])+'</td><td>'+esc(amount(e['remainderRaw']) if 'remainderRaw' in e else '—')+'</td></tr>' for e in report['activity'])
    return '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Учёт покупок Pons</title><style>body{font:16px system-ui;background:#101810;color:#e8eedf;margin:32px}h1{color:#d4f796}a{color:#b9dcff}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:12px;border-bottom:1px solid #354535;text-align:left}main{overflow:auto}p{max-width:900px;line-height:1.6}</style>
<h1>'''+esc(p['project'].upper())+''' · покупки и билеты</h1><p>Источник: Pons API. Локальный расчёт для сравнения, ещё не подключён к розыгрышам.
Сумма — quoteAmount Pons в единицах расчётного актива. Продажи не отменяют билеты.
Показано общее начисление; ранее использованные билеты здесь не вычтены.</p><p>Статус: '''+esc(report['status'])+' · Сделок: '+str(report['tradeCount'])+' · Билетов: '+esc(report['totalTickets'])+' · Порог: '+esc(p['threshold'])+' · Проверено: '+esc(date(report['checkedAt']))+' · Ошибка: '+esc(report['error'] or 'нет')+'''</p><main><table><thead><tr><th>Время</th><th>Транзакция</th><th>Кошелёк Pons</th><th>Сумма</th><th>Действие</th><th>Билеты</th><th>Остаток суммы</th></tr></thead><tbody>'''+rows+'</tbody></table></main></html>'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profiles', required=True)
    parser.add_argument('--db', default='.local/pons-accounting/journal.sqlite3')
    parser.add_argument('--output', default='.local/pons-accounting/reports')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--interval', type=int, default=300)
    args = parser.parse_args()
    if args.interval < 60:
        parser.error('Minimum interval is 60 seconds')
    profiles = json.loads(pathlib.Path(args.profiles).read_text(encoding='utf-8'))
    if not isinstance(profiles, list) or len({p['project'] for p in profiles}) != len(profiles):
        parser.error('Expected distinct project profiles')
    for p in profiles:
        validate_profile(p)
    journal = Journal(args.db); failures = 0
    try:
        while True:
            failed = False
            for p in profiles:
                result = sync(journal, p, force=args.force)
                print(encode(dict(project=p['project'], **result)), flush=True)
                failed |= result['status'] != 'current' and result['status'] != 'unchanged'
                out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True)
                dest = out/(p['project']+'.json'); temp = dest.with_suffix('.tmp')
                report = journal.report(p['project'])
                temp.write_text(encode(report), encoding='utf-8'); temp.replace(dest)
                dest = out/(p['project']+'.html'); temp = dest.with_suffix('.tmp')
                temp.write_text(render_report(report), encoding='utf-8'); temp.replace(dest)
            if not args.watch:
                return 1 if failed else 0
            failures = min(failures+1, 4) if failed else 0
            time.sleep(min(args.interval * 2**failures, 3600))
    finally:
        journal.close()


if __name__ == '__main__':
    raise SystemExit(main())
