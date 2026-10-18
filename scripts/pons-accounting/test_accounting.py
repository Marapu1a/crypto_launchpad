import copy
import json
import pathlib
import tempfile
import unittest

from accounting import Journal, sync, units, render_report

TOKEN='0x'+'1'*40
WALLET='0x'+'2'*40
QUOTE='0x'+'3'*40
PROFILE=dict(project='test',token=TOKEN,quote=QUOTE,decimals=6,threshold='10',excludedWallets=[],venues=['curve'])

def trade(n, amount='6', **fields):
    tx='0x'+format(n,'064x')
    return dict(id=tx+':1',txHash=tx,trader=WALLET,quoteAmount=amount,timestamp=100+n,side='buy',venue='curve',**fields)

class API:
    def __init__(self, rows):
        self.rows=rows; self.calls=0; self.fail=False
    def __call__(self, url):
        self.calls+=1
        if self.fail:raise TimeoutError()
        if '?view=' not in url:
            return dict(address=TOKEN,quote=dict(address=QUOTE,decimals=6),stage='curve',tradeCount=len(self.rows),lastTradeAt=max((r['timestamp'] for r in self.rows),default=0))
        return dict(items=copy.deepcopy(self.rows),nextCursor=None)

class AccountingTests(unittest.TestCase):
    def test_native_eth_precision_and_restart(self):
        profile={**PROFILE,'quote':'0x'+'0'*40,'decimals':18,'threshold':'0.001'}
        api=API([trade(1,'0.0005'),trade(2,'0.000500000000000001')])
        def native_api(url):
            response=api(url)
            if '?view=' not in url:response['quote']={'address':profile['quote'],'decimals':18}
            return response
        self.assertEqual(sync(self.j,profile,native_api,now=1000)['status'],'current')
        report=self.j.report('test')
        self.assertEqual(report['totalTickets'],'1')
        self.assertEqual(report['wallets'][WALLET]['remainderRaw'],'1')
        self.assertEqual(report['activity'][1]['quoteRaw'],'500000000000001')
        self.j.close();self.j=Journal(self.path)
        self.assertEqual(sync(self.j,profile,native_api,now=1100)['requests'],1)
        self.assertEqual(self.j.report('test')['totalTickets'],'1')
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.temp.name)/'ledger.sqlite3';self.j=Journal(self.path)
    def tearDown(self):
        self.j.close();self.temp.cleanup()
    def test_accumulation_restart_sales_and_idempotency(self):
        sell=trade(3,'50');sell['side']='sell'
        api=API([sell,trade(2),trade(1)])
        self.assertEqual(sync(self.j,PROFILE,api,now=1000)['status'],'current')
        r=self.j.report('test');self.assertEqual(r['totalTickets'],'1');self.assertEqual(r['wallets'][WALLET]['remainderRaw'],'2000000')
        self.assertEqual([e['addedTickets'] for e in r['activity']],['0','1','0'])
        self.j.close();self.j=Journal(self.path)
        self.assertEqual(sync(self.j,PROFILE,api,now=1100)['requests'],1)
        self.assertEqual(self.j.report('test')['totalTickets'],'1')
    def test_failure_preserves_and_recovers(self):
        api=API([trade(1,'12')]);sync(self.j,PROFILE,api,now=1000)
        api.fail=True;self.assertEqual(sync(self.j,PROFILE,api,now=1100)['status'],'unavailable')
        self.assertEqual(self.j.report('test')['totalTickets'],'1')
        api.fail=False;api.rows.append(trade(2,'8'))
        self.assertEqual(sync(self.j,PROFILE,api,now=1200)['status'],'current')
        self.assertEqual(self.j.report('test')['totalTickets'],'2')
    def test_correction_is_reviewed_not_overwritten(self):
        api=API([trade(1,'12')]);sync(self.j,PROFILE,api,now=1000)
        api.rows[0]['quoteAmount']='120'
        self.assertEqual(sync(self.j,PROFILE,api,now=1100,force=True)['status'],'review-required')
        self.assertEqual(self.j.report('test')['totalTickets'],'1')
        self.assertEqual(self.j.report('test')['reviewCount'],1)
        self.assertEqual(sync(self.j,PROFILE,api,now=1200)['status'],'review-required')
    def test_deletion_is_reviewed(self):
        api=API([trade(1)]);sync(self.j,PROFILE,api,now=1000);api.rows=[]
        self.assertEqual(sync(self.j,PROFILE,api,now=1100)['status'],'review-required')
        self.assertEqual(self.j.report('test')['tradeCount'],1)
    def test_pagination_and_overlap(self):
        base=API([trade(1),trade(2),trade(3)])
        def get(url):
            if '?view=' not in url:return base(url)
            if '&cursor=' in url:return dict(items=[trade(2),trade(1)],nextCursor=None)
            return dict(items=[trade(3),trade(2)],nextCursor='older')
        self.assertEqual(sync(self.j,PROFILE,get,now=1000)['requests'],4)
        self.assertEqual(self.j.report('test')['tradeCount'],3)
    def test_broken_and_bounded_pagination_never_credits_partial(self):
        base=API([trade(1),trade(2)])
        def get(url):
            return dict(items=[trade(1)],nextCursor='repeat') if '?view=' in url else base(url)
        for limit in (1,5):
            self.assertEqual(sync(self.j,PROFILE,get,now=1000,max_pages=limit)['status'],'unavailable')
            self.assertEqual(self.j.report('test')['tradeCount'],0)
    def test_count_mismatch(self):
        base=API([trade(1),trade(2)])
        def get(url):return dict(items=[trade(1)],nextCursor=None) if '?view=' in url else base(url)
        self.assertEqual(sync(self.j,PROFILE,get,now=1000)['status'],'unavailable')
        self.assertEqual(self.j.report('test')['totalTickets'],'0')
    def test_interrupted_second_page_and_changing_metadata(self):
        base=API([trade(1),trade(2)])
        def get(url):
            if '&cursor=' in url:raise TimeoutError()
            if '?view=' in url:return dict(items=[trade(2)],nextCursor='older')
            return base(url)
        self.assertEqual(sync(self.j,PROFILE,get,now=1000)['status'],'unavailable')
        self.assertEqual(self.j.report('test')['tradeCount'],0)
        self.assertEqual(sync(self.j,PROFILE,base,now=1100)['status'],'current')
        calls=0
        def changing(url):
            nonlocal calls
            value=base(url)
            if '?view=' not in url:
                calls+=1
                if calls==2:value['tradeCount']+=1
            return value
        self.assertEqual(sync(self.j,PROFILE,changing,now=1200,force=True)['status'],'unavailable')
        self.assertEqual(self.j.report('test')['tradeCount'],2)
    def test_exact_precision_and_invalid_numbers(self):
        self.assertEqual(units('0.000001',6),1)
        self.assertEqual(units('198',6),198000000)
        for value in ['NaN','-1','0.0000001',0.1,True,'1e999']:
            with self.assertRaises(ValueError):units(value,6)
    def test_changed_identity_and_parallel_writer(self):
        self.j.register(PROFILE)
        with self.assertRaises(ValueError):self.j.register(dict(PROFILE,threshold='20'))
        with self.assertRaises(ValueError):Journal(self.path)
    def test_unknown_venue_remains_review_required_on_quiet_poll(self):
        row=trade(1);row['venue']='pool';api=API([row])
        self.assertEqual(sync(self.j,PROFILE,api,now=1000)['status'],'review-required')
        api.fail=True;sync(self.j,PROFILE,api,now=1050);api.fail=False
        self.assertEqual(sync(self.j,PROFILE,api,now=1100)['status'],'review-required')
        self.assertEqual(self.j.report('test')['totalTickets'],'0')
    def test_excluded_wallet_and_other_project_isolation(self):
        p=dict(PROFILE,excludedWallets=[WALLET]);api=API([trade(1,'30')])
        sync(self.j,p,api,now=1000)
        sync(self.j,dict(PROFILE,project='other'),api,now=1000)
        self.assertEqual(self.j.report('test')['totalTickets'],'0')
        self.assertEqual(self.j.report('other')['totalTickets'],'3')
        self.assertIn('https://robinhoodchain.blockscout.com/tx/',render_report(self.j.report('other')))

if __name__=='__main__':unittest.main()
