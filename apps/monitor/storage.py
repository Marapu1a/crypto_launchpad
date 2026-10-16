"""Durable market observations; missing buckets are never fabricated as zero trades."""
import json
import sqlite3
from contextlib import contextmanager

PERIOD = 300
RETENTION = 28 * 86400


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS samples (end INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, started REAL NOT NULL, finished REAL, status TEXT NOT NULL, details TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, payload TEXT NOT NULL)')
            yield db
    finally:
        db.close()


def begin_attempt(path, started):
    with connect(path) as db:
        # Only the single writer calls this. Unfinished attempts survived a crash/restart.
        db.execute("UPDATE attempts SET status='interrupted' WHERE status='running'")
        cursor = db.execute('INSERT INTO attempts(started,status,details) VALUES (?,?,?)', (started, 'running', '{}'))
        return cursor.lastrowid


def finish_attempt(path, attempt, finished, status, details, observations=(), snapshot=None):
    with connect(path) as db:
        for end, value in observations:
            previous = db.execute('SELECT payload FROM samples WHERE end=?', (end,)).fetchone()
            # A truncated later fetch must not erase an earlier fully observed interval.
            if previous and json.loads(previous[0]).get('complete') and not value.get('complete'):
                continue
            db.execute('INSERT OR REPLACE INTO samples VALUES (?,?)', (end, json.dumps(value)))
        db.execute('UPDATE attempts SET finished=?,status=?,details=? WHERE id=?', (finished, status, json.dumps(details), attempt))
        if snapshot is not None:
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('snapshot', json.dumps(snapshot)))
        db.execute('DELETE FROM samples WHERE end < ?', (finished-RETENTION,))
        db.execute('DELETE FROM attempts WHERE started < ?', (finished-RETENTION,))


def latest_snapshot(path):
    with connect(path) as db:
        row = db.execute("SELECT payload FROM metadata WHERE key='snapshot'").fetchone()
        return json.loads(row[0]) if row else None


def quality(path, end, span=86400):
    """Coverage since first observed/attempted bucket, limited to the requested span."""
    end = int(end // PERIOD) * PERIOD
    with connect(path) as db:
        first_sample = db.execute('SELECT MIN(end) FROM samples').fetchone()[0]
        first_attempt = db.execute('SELECT MIN(started) FROM attempts').fetchone()[0]
        starts = [x for x in [first_sample, int((first_attempt-60)//PERIOD)*PERIOD if first_attempt is not None else None] if x is not None]
        start = max(end-span+PERIOD, min(starts)) if starts else end
        values = {}
        for t,p in db.execute('SELECT end,payload FROM samples WHERE end BETWEEN ? AND ? ORDER BY end', (start, end)):
            if t % PERIOD == 0:
                x=json.loads(p)
                values[t]=bool(x.get('complete')) and not x.get('error')
        expected = max(0, (end-start)//PERIOD+1)
        complete = sum(bool(x) for x in values.values())
        missing = [t for t in range(start, end+1, PERIOD) if t not in values]
        gaps = []
        for t in missing:
            if gaps and gaps[-1]['to'] == t-PERIOD:
                gaps[-1]['to'] = t; gaps[-1]['intervals'] += 1
            else:
                gaps.append(dict(fromEnd=t, to=t, intervals=1))
        recent = [dict(id=i, started=s, finished=f, status=st, **json.loads(d)) for i,s,f,st,d in db.execute('SELECT id,started,finished,status,details FROM attempts ORDER BY id DESC LIMIT 10')]
    return dict(fromEnd=start, toEnd=end, periodSeconds=PERIOD, expected=expected,
                stored=len(values), complete=complete, incomplete=len(values)-complete,
                missing=len(missing), completePct=round(100*complete/expected, 2) if expected else None,
                gaps=gaps, recentAttempts=recent)
