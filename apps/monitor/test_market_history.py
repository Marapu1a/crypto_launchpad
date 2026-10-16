import unittest, tempfile, pathlib
from unittest.mock import patch
import monitor
from market_history import comparison, save_sample, samples

class HistoryTests(unittest.TestCase):
    def sample(self,end,buyers=10,buys=20,complete=True):
        return dict(windowEnd=end,complete=complete,current=dict(buyers=buyers,buys=buys,tokens=4),breadth=dict(qualifiedTokens=4,leaderPct=25))

    def test_retention_upsert_and_missing_intervals(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'history.db';end=2000000000
            save_sample(path,end-29*86400,self.sample(end-29*86400))
            save_sample(path,end,self.sample(end));save_sample(path,end,self.sample(end,20))
            self.assertEqual(len(samples(path)),1)
            self.assertEqual(samples(path)[0][1]['current']['buyers'],20)

    def test_rank_excludes_partial_future_overlapping_and_previous_day(self):
        end=1780401600
        history=[(end-300*i,self.sample(end-300*i)) for i in range(1,13)]
        history.extend([(end-1,self.sample(end-1)),(end+300,self.sample(end+300)),(end-4000,self.sample(end-4000,complete=False))])
        current=self.sample(end,40,80)
        result=comparison(current,history)
        self.assertEqual(result['todaySamples'],12)
        self.assertEqual(result['today']['buyers'],100)
        self.assertEqual(result['label'],'Широкий ажиотаж')
        current['breadth']['leaderPct']=90
        self.assertEqual(comparison(current,history)['label'],'Локальный ажиотаж')
        current['current']['buyers']=10
        self.assertEqual(comparison(current,history)['label'],'Повторные покупки узкого круга')
        current['complete']=False
        self.assertEqual(comparison(current,history)['label'],'Недостаточно полных данных')

    def test_seasonal_requires_distinct_days(self):
        end=1780401600;current=self.sample(end)
        history=[(end-day*86400-i*300,self.sample(end-day*86400-i*300)) for day in range(1,4) for i in range(4)]
        result=comparison(current,history)
        self.assertEqual(result['seasonalDays'],3);self.assertIsNotNone(result['seasonal'])
        self.assertIsNone(result['today'])

    def test_incremental_overlap_dedup_and_partial_not_committed(self):
        token={'address':'cache-test'}
        monitor.CACHE.clear()
        first={'items':[dict(id='a',timestamp=1000)],'nextCursor':None}
        with patch.object(monitor,'read',return_value=first),patch.object(monitor.time,'time',return_value=1260):
            monitor.history(token,0)
        newer={'items':[dict(id='b',timestamp=1300),dict(id='a',timestamp=1000),dict(id='c',timestamp=899)],'nextCursor':'next'}
        with patch.object(monitor,'read',return_value=newer) as read,patch.object(monitor.time,'time',return_value=1460):
            _,rows,ok=monitor.history(token,0)
        self.assertTrue(ok);self.assertEqual(read.call_count,1);self.assertEqual(len(rows),3)
        before=monitor.CACHE[token['address']].copy()
        with patch.object(monitor,'read',return_value={'items':[dict(id='new',timestamp=1500)],'nextCursor':'more'}):
            self.assertFalse(monitor.history(token,0)[2])
        self.assertEqual(monitor.CACHE[token['address']],before)
        monitor.CACHE.clear()

if __name__=='__main__':unittest.main()
