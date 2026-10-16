import copy
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.request
from unittest.mock import patch

import monitor
from market_history import samples
from process_lock import single_writer
from storage import begin_attempt, finish_attempt, latest_snapshot, quality


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = pathlib.Path(self.tmp.name)
        self.db = self.directory/'market.sqlite3'
        self.cache = self.directory/'trade-cache.json'
        self.end = 1800000
        monitor.CACHE.clear()
        monitor.STATE = {'loading':True}
        monitor.STOP.clear()
        monitor.REQUESTS=0
        monitor.SCAN_DEADLINE=None

    def tearDown(self):
        self.tmp.cleanup()

    def collect(self, end=None, complete=True, rows=None):
        end = self.end if end is None else end
        token=dict(address='token',createdAt=end-2000,deployer='owner',symbol='T',quote={'symbol':'ETH'})
        if rows is None:
            rows=[dict(id='a',timestamp=end-1201,side='buy',venue='curve',trader='alice',quoteAmount='2')]
        monitor.CURRENT_TOKENS=[token]
        monitor.CURRENT_HISTORIES=[(token,rows,complete)]
        result=monitor.measure([token],monitor.CURRENT_HISTORIES,end)
        result.update(windowEnd=end,updated=end+60,complete=complete,error=None,loading=False,
                      coverage={'launches':True,'incompleteTokens':[] if complete else ['token']})
        return result

    def run_scan(self, end=None, complete=True, rows=None):
        end = self.end if end is None else end
        with patch.object(monitor.time,'time',return_value=end+60):
            return monitor.run_once(self.db,self.cache,lambda:self.collect(end,complete,rows))

    def test_backfill_is_bounded_and_repeated_scans_do_not_double_count(self):
        self.run_scan()
        first=samples(self.db)
        self.assertEqual(len(first),7)
        self.assertEqual(sum(x['current']['buys'] for _,x in first),1)
        self.run_scan()
        self.assertEqual(len(samples(self.db)),7)
        # One hour offline: only the most recent 35m can be recovered.
        result=self.run_scan(self.end+3600)
        self.assertEqual(len(samples(self.db)),14)
        self.assertEqual(result['collection']['missing'],5)
        self.assertEqual(result['collection']['complete'],14)

    def test_partial_scan_uses_its_rows_and_does_not_replace_good_history(self):
        monitor.CACHE['token']={'rows':{'fake':dict(id='fake',timestamp=self.end-1,side='buy',venue='curve',trader='fake',quoteAmount='999')},'until':self.end,'from':0}
        result=self.run_scan(complete=False,rows=[])
        self.assertEqual(result['collection']['incomplete'],7)
        self.assertTrue(all(x['current']['buys']==0 for _,x in samples(self.db)))
        self.assertFalse(latest_snapshot(self.db)['complete'])
        self.run_scan(complete=True)
        self.assertTrue(all(x['complete'] for _,x in samples(self.db)))
        self.run_scan(complete=False,rows=[])
        self.assertEqual(sum(x['current']['buys'] for _,x in samples(self.db)),1)
        self.assertTrue(all(x['complete'] for _,x in samples(self.db)))

    def test_failures_and_interrupted_attempts_survive_restart_without_exposing_urls(self):
        self.run_scan()
        with patch.object(monitor.time,'time',return_value=self.end+360):
            result=monitor.run_once(self.db,self.cache,lambda:(_ for _ in ()).throw(ValueError('https://user:secret@example.com')))
        self.assertEqual(result['error'],'ValueError')
        self.assertEqual(len(samples(self.db)),7)
        self.assertEqual(quality(self.db,self.end+300)['recentAttempts'][0]['status'],'error')
        self.assertNotIn('secret',json.dumps(result))
        self.assertEqual(latest_snapshot(self.db)['windowEnd'],self.end)
        begin_attempt(self.db,self.end+600)
        begin_attempt(self.db,self.end+900)
        self.assertEqual(quality(self.db,self.end+900)['recentAttempts'][1]['status'],'interrupted')

    def test_cache_without_coverage_or_with_later_lower_bound_refetches(self):
        token={'address':'token'}
        for cached in [dict(rows={},until=1500),dict(rows={},until=1500,**{'from':1200})]:
            monitor.CACHE['token']=cached
            pages=[{'items':[dict(id='new',timestamp=1400),dict(id='mid',timestamp=1100)],'nextCursor':'p2'},
                   {'items':[dict(id='old',timestamp=900)],'nextCursor':None}]
            with patch.object(monitor,'read',side_effect=pages) as read:
                _,rows,ok=monitor.history(token,1000,1800)
            self.assertTrue(ok)
            self.assertEqual(read.call_count,2)
            self.assertEqual(len(rows),2)

    def test_pagination_limit_and_duplicate_cursor_are_explicit_incomplete(self):
        token={'address':'token'}
        with patch.object(monitor,'read',return_value={'items':[dict(id='a',timestamp=1000)],'nextCursor':'same'}) as read:
            self.assertFalse(monitor.history(token,0,1800)[2])
        self.assertEqual(read.call_count,2)
        self.assertNotIn('token',monitor.CACHE)

    def test_scan_limits_prevent_another_network_request(self):
        with patch.object(monitor.urllib.request,'urlopen',side_effect=AssertionError('No network')):
            monitor.REQUESTS=monitor.MAX_REQUESTS
            with self.assertRaises(monitor.ScanLimitError): monitor.read('https://ponsfamily.com/api/launches')
            monitor.REQUESTS=0;monitor.SCAN_DEADLINE=1
            with self.assertRaises(TimeoutError): monitor.read('https://ponsfamily.com/api/launches')
        monitor.SCAN_DEADLINE=None

    def test_single_writer_lock_is_released(self):
        with single_writer(self.directory):
            with self.assertRaisesRegex(RuntimeError,'Another collector'):
                with single_writer(self.directory): pass
        with single_writer(self.directory): pass

    def test_startup_storage_error_keeps_retry_loop_alive(self):
        # A failed initial snapshot read must not leave an apparently running HTTP
        # server with a dead collector thread.
        def stop_after_wait(seconds): monitor.STOP.set();return True
        with patch.object(monitor,'LOG',self.directory),patch.object(monitor,'latest_snapshot',side_effect=OSError()),patch.object(monitor,'run_once',side_effect=OSError()) as run,patch.object(monitor.STOP,'wait',side_effect=stop_after_wait):
            monitor.worker()
        self.assertEqual(run.call_count,1)
        self.assertEqual(monitor.STATE['error'],'StorageUnavailable')
        self.assertFalse(monitor.STATE['loading'])
        monitor.STOP.clear()

    def test_refresh_requests_do_not_collect_or_mutate_snapshot(self):
        server=monitor.http.server.ThreadingHTTPServer(('127.0.0.1',0),monitor.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        monitor.STATE=dict(windowEnd=self.end,updated=self.end+60,loading=False,refreshing=False,signal=False)
        before=copy.deepcopy(monitor.STATE)
        try:
            with patch.object(monitor,'read',side_effect=AssertionError('No Pons calls allowed')):
                for _ in range(3):
                    request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/refresh',method='POST',headers={'X-Monitor-Refresh':'1'})
                    with urllib.request.urlopen(request) as response:
                        self.assertFalse(json.load(response)['collectionScheduled'])
                    with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/status') as response:
                        self.assertTrue(json.load(response)['stale'])
            self.assertEqual(monitor.STATE,before)
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_new_wallets_are_new_to_token_and_unknown_when_history_is_partial(self):
        token=dict(address='t',createdAt=1000,deployer='owner',symbol='T',quote={'symbol':'ETH'})
        rows=[dict(id=str(i),timestamp=ts,trader=who,quoteAmount='1',side='buy',venue='curve') for i,(ts,who) in enumerate([(1100,'alice'),(1800,'ALICE'),(1900,'bob')])]
        full=monitor.measure([token],[(token,rows,True)],2000)['board'][0]
        self.assertEqual(full['newBuyers'],1)
        self.assertEqual(full['lastBuyAt'],1900)
        partial=monitor.measure([token],[(token,rows,False)],2000)['board'][0]
        self.assertIsNone(partial['newBuyers'])


if __name__=='__main__': unittest.main()
