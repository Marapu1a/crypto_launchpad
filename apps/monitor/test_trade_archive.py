import unittest,tempfile,pathlib
from trade_archive import append,ranking,feed
class ArchiveTest(unittest.TestCase):
 def test_dedup_intervals_and_raw_feed(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'trades.sqlite3';token=dict(address='0x'+'1'*40,symbol='TEST',createdAt=1000,deployer='0x'+'2'*40,quote=dict(symbol='ETH'),quoteUsd=2000)
   rows=[dict(id=str(i),side='buy',venue='curve',trader='0x'+'3'*40,timestamp=t,quoteAmount=1) for i,t in enumerate([1100,2800,4400])]
   rows.append(dict(rows[-1],id='pool',venue='pool',side='sell'))
   append(path,[(token,rows,True)],4500,True);append(path,[(token,rows,True)],4500,True)
   self.assertEqual(len(feed(path,0)['events']),4)
   self.assertEqual(ranking(path,4500,5)['walletActivity'][0]['buys'],1)
   self.assertEqual(ranking(path,4500,30)['walletActivity'][0]['buys'],2)
   self.assertEqual(ranking(path,4500,60)['walletActivity'][0]['buys'],3)
   self.assertTrue(ranking(path,4500,5)['complete']);self.assertFalse(ranking(path,4500,30)['complete'])
   cursor=feed(path,None)['cursor'];self.assertEqual(feed(path,cursor)['events'],[])
   self.assertEqual(ranking(path,4500,60)['walletActivity'][0]['volumeUsd'],'6000')
 def test_missing_price_and_old_feed_cursor(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'trades.sqlite3';token=dict(address='a',symbol='A',createdAt=0,deployer='b',quote=dict(symbol='ETH'))
   row=dict(id='1',side='buy',venue='curve',trader='c',timestamp=100,quoteAmount=5)
   append(path,[(token,[row],True)],300,True)
   self.assertIsNone(ranking(path,300,5)['walletActivity'][0]['volumeUsd'])
   cursor=feed(path,None)['cursor'];append(path,[],300+29*86400,True)
   self.assertEqual(feed(path,None)['cursor'],cursor)
if __name__=='__main__':unittest.main()
