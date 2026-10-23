import json
import unittest
from unittest.mock import patch
import monitor


class PaginationRecoveryTests(unittest.TestCase):
    def setUp(self):
        monitor.CACHE.clear()
        monitor.HISTORY_ISSUES.clear()
        self.token=dict(address='busy',createdAt=0)

    def page(self, times, cursor):
        return dict(items=[dict(id=str(t),timestamp=t) for t in times],nextCursor=cursor)

    def test_resumes_after_serialized_restart_then_refreshes_head(self):
        with patch.object(monitor,'TRADE_PAGES',1),patch.object(monitor,'read',return_value=self.page([900,800],'tail')):
            t,rows,ok=monitor.history(self.token,0,1000)
        self.assertFalse(ok)
        self.assertEqual(t['tradeCoverage'],[[801,1000]])
        self.assertTrue(monitor.interval_complete([(t,rows,ok)],1000,True) is False)
        monitor.CACHE=json.loads(json.dumps(monitor.CACHE))
        with patch.object(monitor,'TRADE_PAGES',2),patch.object(monitor,'read',side_effect=[self.page([700,100],None),self.page([1100,900,600],'more')]) as read:
            _,rows,ok=monitor.history(self.token,0,1200)
        self.assertTrue(ok)
        self.assertIn('cursor=tail',read.call_args_list[0].args[0])
        self.assertNotIn('cursor=',read.call_args_list[1].args[0])
        self.assertEqual({r['timestamp'] for r in rows},{100,600,900,1100})
        self.assertNotIn('pending',monitor.CACHE['busy'])

    def test_recent_complete_bucket_without_complete_birth_history(self):
        with patch.object(monitor,'TRADE_PAGES',1),patch.object(monitor,'read',return_value=self.page([1190,800],'tail')):
            t,rows,ok=monitor.history(self.token,0,1200)
        h=[(t,rows,ok)]
        self.assertTrue(monitor.interval_complete(h,1200,True))
        self.assertFalse(monitor.interval_complete(h,900,True))
        self.assertFalse(monitor.interval_complete(h,1200,False))

    def test_new_token_does_not_poison_earlier_buckets(self):
        t=dict(self.token,createdAt=1000)
        self.assertTrue(monitor.interval_complete([(t,[],False)],900,True))
        self.assertFalse(monitor.interval_complete([(t,[],False)],1200,True))

    def test_timestamp_ties_do_not_claim_boundary_complete(self):
        with patch.object(monitor,'TRADE_PAGES',1),patch.object(monitor,'read',return_value=self.page([1190,900],'tail')):
            h=monitor.history(self.token,0,1200)
        self.assertFalse(monitor.interval_complete([h],1200,True))

    def test_reversed_cursor_drops_untrusted_progress(self):
        with patch.object(monitor,'read',side_effect=[self.page([900,800],'tail'),self.page([950,700],'bad')]):
            t,rows,ok=monitor.history(self.token,0,1000)
        self.assertFalse(ok)
        self.assertEqual(t['tradeCoverage'],[])
        self.assertNotIn('busy',monitor.CACHE)

    def test_timeout_preserves_cursor_for_retry(self):
        with patch.object(monitor,'read',side_effect=[self.page([900,800],'tail'),TimeoutError()]):
            monitor.history(self.token,0,1000)
        self.assertEqual(monitor.CACHE['busy']['pending']['cursor'],'tail')
        with patch.object(monitor,'read',return_value=self.page([700],None)) as read:
            self.assertTrue(monitor.history(self.token,0,1000)[2])
        self.assertIn('cursor=tail',read.call_args.args[0])
