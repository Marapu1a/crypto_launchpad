import pathlib,tempfile,unittest
import wallets

class WalletTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'wallets.db';wallets.LAST_REQUEST=0
        self.a='0x'+'1'*40
        self.row=dict(token='0x'+'2'*40,txHash='0x'+'3'*64,kind='buy',timestamp=100,symbol='T',amountTokens=1,valueUsd=2)
    def tearDown(self):self.tmp.cleanup()
    def loader(self,a,view):return {'items':[self.row] if view=='trades' else []}
    def test_cache_restart_and_duplicate_history(self):
        first=wallets.snapshot(self.path,self.a,self.loader,1000)
        def forbidden(*args):raise AssertionError('Cache must not fetch')
        second=wallets.snapshot(self.path,self.a,forbidden,1100)
        self.assertEqual(first,second)
        third=wallets.snapshot(self.path,self.a,self.loader,1400)
        self.assertEqual(third['stats']['buys'],1);self.assertEqual(third['firstObservedAt'],1000)
        self.assertFalse(third['historyComplete']);self.assertIsNone(third['nativeBalance'])
    def test_failure_preserves_previous_history_with_old_timestamp(self):
        wallets.snapshot(self.path,self.a,self.loader,1000)
        def broken(*args):raise TimeoutError('secret URL')
        d=wallets.snapshot(self.path,self.a,broken,1400)
        self.assertEqual(d['historyUpdatedAt'],1000);self.assertEqual(d['stats']['buys'],1)
        self.assertEqual(d['errors']['history'],'TimeoutError');self.assertNotIn('secret',str(d))
    def test_gap_transfers_and_global_budget(self):
        wallets.snapshot(self.path,self.a,self.loader,1000)
        self.row=dict(self.row,txHash='0x'+'4'*64,kind='receive',timestamp=1200)
        d=wallets.snapshot(self.path,self.a,self.loader,1400)
        self.assertTrue(d['gapPossible']);self.assertEqual(d['stats']['operations'],2);self.assertEqual(d['stats']['buys'],1)
        self.assertTrue(wallets.snapshot(self.path,'0x'+'5'*40,self.loader,1401)['busy'])
    def test_invalid_wallet_and_event(self):
        with self.assertRaises(ValueError):wallets.snapshot(self.path,'../bad',self.loader,1000)
        with self.assertRaises(ValueError):wallets.event(dict(self.row,txHash='javascript:bad'))

    def test_multiple_rows_in_one_transaction_are_summed(self):
        def loader(a,view):return {'items':[self.row,dict(self.row,amountTokens=4)] if view=='trades' else []}
        d=wallets.snapshot(self.path,self.a,loader,1000)
        self.assertEqual(d['events'][0]['amountTokens'],'5')
        self.assertEqual(d['events'][0]['sourceRows'],2)

    def test_wallet_route_accepts_shareable_query_url(self):
        import monitor,threading,urllib.request
        server=monitor.http.server.ThreadingHTTPServer(('127.0.0.1',0),monitor.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/wallets?address={self.a}') as response:
                self.assertIn(b'id="load"',response.read())
        finally:server.shutdown();server.server_close();thread.join()

    def test_cached_wallet_is_not_blocked_by_other_network_request(self):
        first=wallets.snapshot(self.path,self.a,self.loader,1000)
        wallets.GATE.acquire()
        try:
            self.assertEqual(wallets.snapshot(self.path,self.a,self.loader,1100),first)
            busy=wallets.snapshot(self.path,'0x'+'6'*40,self.loader,1100)
            self.assertTrue(busy['busy']);self.assertEqual(busy['retryAfter'],3)
        finally:wallets.GATE.release()

    def test_new_activity_api_units_and_unknown_decimals(self):
        raw=dict(token=self.row['token'],tx=self.row['txHash'],kind='buy',time=100,amount='1234567890123456789',decimals=18,usd=None)
        self.assertEqual(wallets.activity_row(raw)['amountTokens'],'1.234567890123456789')
        self.assertIsNone(wallets.activity_row(dict(raw,decimals=None))['amountTokens'])

    def test_failed_history_is_unknown_not_zero_and_retries_after_one_minute(self):
        def broken(*args):raise wallets.ActivityAccessUnavailable()
        d=wallets.snapshot(self.path,self.a,broken,1000)
        self.assertIsNone(d['stats']['buys'])
        fixed=wallets.snapshot(self.path,self.a,self.loader,1061)
        self.assertEqual(fixed['stats']['buys'],1)
