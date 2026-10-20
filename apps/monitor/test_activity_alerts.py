import unittest,tempfile
from pathlib import Path
import activity_alerts as a

class ActivityTests(unittest.TestCase):
 def history(self,end=21000):
  return {t:dict(windowEnd=t,complete=True,current=dict(buyers=10,buys=15,tokens=3),board=[]) for t in range(end-1800,end+1,300)}
 def test_threshold_and_missing(self):
  h=self.history();h[21000]['current'].update(buyers=40,buys=60)
  self.assertTrue(a.evaluate(h,21000)['trigger'])
  h[21000]['current']['buyers']=4;self.assertFalse(a.evaluate(h,21000)['trigger'])
  h[20700]['complete']=False;self.assertIsNone(a.evaluate(h,21000))
 def test_durable_dedup_frozen_interval_and_gap(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'alerts.sqlite3';h=self.history();h[21000]['current'].update(buyers=40,buys=60)
   a.record(p,h,21000,21001);a.record(p,h,21000,21002)
   h[21000]['current']['buyers']=999
   self.assertEqual(a.snapshot(p,21000)['current']['buyers'],40)
   for end in range(21300,22501,300):
    h[end]=dict(windowEnd=end,complete=end!=21600,current=dict(buyers=40,buys=60,tokens=3),board=[])
    a.record(p,h,end,end+1)
   self.assertEqual(len(a.feed(p)['events']),1)
   # Three quiet complete intervals rearm. Then a new large spike is one event.
   for end in range(22800,23701,300):
    h[end]=dict(windowEnd=end,complete=True,current=dict(buyers=1,buys=1,tokens=1),board=[])
    a.record(p,h,end,end+1)
   h[24000]=dict(windowEnd=24000,complete=True,current=dict(buyers=200,buys=300,tokens=10),board=[])
   a.record(p,h,24000,24001);self.assertEqual(len(a.feed(p)['events']),2)
   self.assertIsNone(a.snapshot(p,99900))
 def test_stale_cannot_trigger(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'a.sqlite3';h=self.history();h[21000]['current'].update(buyers=400,buys=600)
   a.record(p,h,21000,23000);self.assertEqual(a.feed(p)['events'],[])

if __name__=='__main__':unittest.main()
