"""Wallet comparisons from already observed trades; no RPC."""
import json,time,urllib.request
from decimal import Decimal,InvalidOperation
IDENTITIES={}

def estimate(row):
    try:
        amount=Decimal(str(row.get('quoteAmount')));rate=Decimal(str(row.get('quoteUsd')))
        if not amount.is_finite() or not rate.is_finite() or amount<0 or rate<=0:return None
        return amount*rate
    except (InvalidOperation,ValueError):return None

def summarize_wallets(events,end,minutes=5):
    wallets={}
    for row in events:
        if not end-minutes*60<=row['timestamp']<end:continue
        wallet=wallets.setdefault(row['trader'].lower(),{})
        token=wallet.setdefault(row['token'],dict(address=row['token'],symbol=row.get('symbol'),buys=0,amount=Decimal(0),missing=False))
        token['buys']+=1;value=estimate(row)
        if value is None:token['missing']=True
        else:token['amount']+=value
    result=[]
    for address,tokens in wallets.items():
        details=[dict(address=t['address'],symbol=t['symbol'],buys=t['buys'],volumeUsd=None if t['missing'] else str(t['amount'])) for t in tokens.values()]
        result.append(dict(address=address,buys=sum(t['buys'] for t in tokens.values()),tokens=len(tokens),volumeUsd=None if any(t['missing'] for t in tokens.values()) else str(sum((t['amount'] for t in tokens.values()),Decimal(0))),tokenDetails=details))
    return sorted(result,key=lambda x:(x['volumeUsd'] is None,-Decimal(x['volumeUsd'] or 0),-x['buys'],x['address']))[:30]

def enrich_names(rows):
    """One bounded batch, cached for an hour; failure never drops activity."""
    now=time.time();missing=[x['address'] for x in rows if now-IDENTITIES.get(x['address'],(0,None))[0]>3600]
    if missing:
        try:
            req=urllib.request.Request('https://ponsfamily.com/api/identities?addresses='+','.join(missing),headers={'Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=8) as response:raw=response.read(200001)
            if len(raw)>200000:raise ValueError('Response too large')
            identities=json.loads(raw)['identities']
            if not isinstance(identities,dict):raise ValueError('Invalid identities')
            for a in missing:IDENTITIES[a]=(now,identities.get(a))
        except (OSError,ValueError,KeyError,TypeError):pass
    for row in rows:
        identity=IDENTITIES.get(row['address'],(0,None))[1]
        if isinstance(identity,dict):
            name=identity.get('username') or identity.get('displayName')
            if isinstance(name,str) and name.strip():row['username']=name.strip()[:100]
    if len(IDENTITIES)>1000:
        for a in list(IDENTITIES):
            if now-IDENTITIES[a][0]>3600:IDENTITIES.pop(a,None)
