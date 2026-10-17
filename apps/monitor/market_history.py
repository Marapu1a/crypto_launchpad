"""Persistent, non-overlapping market samples. All calendar comparisons use MSK."""
import json, sqlite3, datetime, statistics
from contextlib import closing

MSK=datetime.timezone(datetime.timedelta(hours=3))

def save_sample(path, end, result):
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS samples (end INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
        db.execute('INSERT OR REPLACE INTO samples VALUES (?,?)',(end,json.dumps(result)))
        db.execute('DELETE FROM samples WHERE end < ?', (end-28*86400,))

def samples(path, summary=False):
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS samples (end INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
        result=[]
        for end,payload in db.execute('SELECT end,payload FROM samples ORDER BY end'):
            value=json.loads(payload)
            if summary:
                value={k:value[k] for k in ('windowEnd','current','complete','error') if k in value}
            result.append((end,value))
        return result

def comparison(result, history):
    end=result['windowEnd']; now=datetime.datetime.fromtimestamp(end,MSK)
    eligible=[(t,x) for t,x in history if end-28*86400<=t<=end-300 and x.get('complete') and not x.get('error')]
    today=[]; seasonal=[]; days=set(); groups={}
    for t,x in eligible:
        dt=datetime.datetime.fromtimestamp(t,MSK)
        if dt.date()==now.date(): today.append(x)
        # Compare actual windows around previous-day anchors, including midnight.
        for day in range(1,29):
            if abs(t-(end-day*86400))<=1800:
                seasonal.append(x);days.add(day);groups.setdefault(day,{})[t]=x;break
    def rank(rows):
        return {k:round(100*sum(x['current'][k]<result['current'][k] for x in rows)/len(rows),1) for k in ('buyers','buys','tokens')} if rows else None
    midnight=int(now.replace(hour=0,minute=0,second=0,microsecond=0).timestamp())
    expected=max(1,(end-midnight)//300-1)
    today_coverage=min(100,100*len(today)/expected)
    daily=[{'current':{k:statistics.median(x['current'][k] for x in rows.values()) for k in ('buyers','buys','tokens')}} for rows in groups.values() if len(rows)>=11]
    ready=len(today)>=36 and today_coverage>=80
    seasonal_ready=len(daily)>=7
    label='Наблюдения за 5 минут' if result.get('complete') else 'Неполные данные'
    ready=ready and bool(result.get('complete'))
    seasonal_ready=seasonal_ready and bool(result.get('complete'))
    return dict(label=label,today=rank(today) if ready else None,todaySamples=len(today),seasonal=rank(daily) if seasonal_ready else None,seasonalSamples=len(seasonal),seasonalDays=len(days),seasonalQualifiedDays=len(daily),todayCoverage=round(today_coverage,1),storedSamples=len(history),experimental=True)
