import copy,json,pathlib,sqlite3,tempfile,unittest
from contextlib import closing
from market_signals import DEFAULT,evaluate,record,report
ETH='0x'+'0'*40
def window(end,buyers=5,buys=8,amount='0.01'):
    return dict(windowEnd=end,complete=True,error=None,current=dict(buyers=buyers,buys=buys,tokens=2,launches=1),
                volumes=[dict(asset=ETH,symbol='ETH',volume=amount,missingAmounts=0,buyers=buyers,buys=buys)],board=[])
def history():return {t:window(t) for t in range(300,4201,300)}
class Signals(unittest.TestCase):
 def test_two_high_not_monotone(self):
  h=history();h[3900]=window(3900,24,35);h[4200]=window(4200,20,30)
  r=evaluate(h,4200,4260);self.assertTrue(r['checks'][0]['trigger']);self.assertEqual(len(r['checks'][0]['baselineEnds']),12)
  self.assertNotIn(3900,r['checks'][0]['baselineEnds']);self.assertEqual(r['checks'][0]['baseline']['buyers'],'5')
 def test_one_peak_and_micro_base(self):
  h=history();h[4200]=window(4200,40,60);self.assertFalse(evaluate(h,4200,4260)['checks'][0]['trigger'])
  h={t:window(t,0,0,'0') for t in h};h[3900]=window(3900,2,3,'0');h[4200]=window(4200,8,15,'0')
  self.assertFalse(any(x['trigger'] for x in evaluate(h,4200,4260)['checks']))
 def test_missing_and_stale(self):
  for kind in ('missing','partial','error','amount'):
   h=history();h[4200]=window(4200,20,30,'0.2')
   if kind=='missing':del h[900]
   if kind=='partial':h[900]['complete']=False
   if kind=='error':h[900]['error']='outage'
   if kind=='amount':h[900]['volumes'][0]['volume']=None
   check=evaluate(h,4200,4260)['checks'][1];self.assertEqual(check['status'],'insufficient');self.assertFalse(check['trigger'])
  self.assertEqual(evaluate(history(),4200,5200)['reason'],'stale_or_incomplete')
 def test_counts_do_not_require_prices(self):
  h=history();h[3900]=window(3900,20,30,None);h[4200]=window(4200,20,30,None)
  r=evaluate(h,4200,4260);self.assertTrue(r['checks'][0]['trigger']);self.assertEqual(r['checks'][1]['status'],'insufficient')
 def test_separate_assets_and_no_dollar_trigger(self):
  h=history()
  for w in h.values():w['quoteUsd']=2000
  h[4200]['quoteUsd']=999999;h[4200]['volumes'].append(dict(asset='other',symbol='ETH',volume='100',missingAmounts=0))
  self.assertFalse(any(x['trigger'] for x in evaluate(h,4200,4260)['checks']))
 def test_single_large_buyer_is_labelled_not_hidden(self):
  h=history();h[4200]=window(4200,1,1,'0.2');r=evaluate(h,4200,4260)
  self.assertFalse(r['checks'][0]['trigger']);self.assertTrue(r['checks'][1]['trigger']);self.assertTrue(r['checks'][1]['concentrated'])
 def test_absent_volume_list_is_unknown_not_zero(self):
  h=history();del h[900]['volumes'];self.assertEqual(evaluate(h,4200,4260)['checks'][1]['status'],'insufficient')
  h[900]['volumes']=[];self.assertEqual(evaluate(h,4200,4260)['checks'][1]['status'],'ready')
 def test_journal_dedup_restart_combination_revision(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'signals.sqlite3';h=history();h[3900]=window(3900,20,30);h[4200]=window(4200,20,30,'0.2')
   first=record(path,h,4200,4260);self.assertEqual(len(first['newReasons']),2);self.assertFalse(first['delivery'])
   self.assertEqual(record(path,h,4200,4260),first);self.assertEqual(len(report(path)['episodes']),1)
   h[4200]=window(4200);self.assertEqual(record(path,h,4200,4260),first)
   with closing(sqlite3.connect(path)) as db:self.assertEqual(db.execute('SELECT count(*) FROM revisions').fetchone()[0],1)
   saved=report(path,first['episodeId']);self.assertEqual(saved['windows']['4200']['current']['buyers'],20)
   for end in (4500,4800):h[end]=window(end,20,30,'0.2');r=record(path,h,end,end+60);self.assertEqual(r['episodeId'],first['episodeId']);self.assertEqual(r['newReasons'],[])
 def test_missing_does_not_rearm_and_three_quiet_windows_close(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'signals.sqlite3';h=history();h[4200]=window(4200,1,1,'0.2');first=record(path,h,4200,4260)
   h[4500]=window(4500);h[4500]['complete']=False;record(path,h,4500,4560)
   self.assertEqual(report(path,first['episodeId'])['status'],'active')
   for end in (4800,5100,5400):h[end]=window(end);record(path,h,end,end+60)
   self.assertEqual(report(path,first['episodeId'])['status'],'closed')
 def test_backfill_and_config_version(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'signals.sqlite3';h=history();record(path,h,4200,4260)
   self.assertEqual(record(path,h,3900,3960)['status'],'historical')
   c=copy.deepcopy(DEFAULT);c['volumeFactor']='4'
   self.assertNotEqual(record(path,h,4200,4260,c)['configId'],record(path,h,4200,4260)['configId'])
if __name__=='__main__':unittest.main()
