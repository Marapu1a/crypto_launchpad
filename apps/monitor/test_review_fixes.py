import unittest
from unittest.mock import patch
import monitor
from market_history import comparison


class ReviewFixTests(unittest.TestCase):
    def test_malformed_pages_rejected_in_both_paths(self):
        for page in [{'items':[]},{'items':[],'nextCursor':''},{'items':[],'nextCursor':'more'},{'items':[{}],'nextCursor':False}]:
            with self.subTest(page=page), patch.object(monitor,'read',return_value=page):
                monitor.CACHE.clear()
                with self.assertRaises(ValueError): monitor.history({'address':'t'},0,2000)
                with self.assertRaises(ValueError): monitor.collect(2000)
                self.assertEqual(monitor.CACHE,{})

    def test_deleted_trade_removed_only_in_rechecked_overlap(self):
        monitor.CACHE.clear()
        token={'address':'t'}
        page={'items':[{'id':'old','timestamp':400},{'id':'gone','timestamp':900}],'nextCursor':None}
        with patch.object(monitor,'read',return_value=page): monitor.history(token,0,1000)
        with patch.object(monitor,'read',return_value={'items':[],'nextCursor':None}):
            _,rows,complete=monitor.history(token,0,1100)
        self.assertTrue(complete)
        self.assertEqual([r['id'] for r in rows],['old'])
        monitor.CACHE.clear()

    def test_daily_comparisons_need_seven_well_covered_days(self):
        end=1792109400
        def sample(value): return {'complete':True,'current':dict(buyers=value,buys=value,tokens=value)}
        current=dict(sample(10),windowEnd=end)
        history=[(end-day*86400+offset*300,sample(5 if day<7 else 20)) for day in range(1,8) for offset in range(-6,7)]
        result=comparison(current,history)
        self.assertEqual(result['seasonalQualifiedDays'],7)
        self.assertEqual(result['seasonal']['buyers'],85.7)
        self.assertIsNone(comparison(current,history[:-3])['seasonal'])

    def test_today_requires_hours_and_coverage(self):
        import datetime
        from market_history import MSK
        end=int(datetime.datetime(2026,10,17,4,0,tzinfo=MSK).timestamp())
        sample={'complete':True,'current':dict(buyers=5,buys=5,tokens=5)}
        current=dict(sample,windowEnd=end)
        history=[(end-i*300,sample) for i in range(1,48)]
        self.assertIsNotNone(comparison(current,history)['today'])
        self.assertIsNone(comparison(current,history[:36])['today'])
