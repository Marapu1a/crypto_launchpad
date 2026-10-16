import unittest
from unittest.mock import patch
import monitor
from monitor import measure, purchase_metrics, social_url

class MetricsTests(unittest.TestCase):
    def test_collection_fetches_birth_not_just_chart_window(self):
        token=dict(address='token',createdAt=1000,deployer='owner',symbol='T',quote={'symbol':'USDG'},protocol='v2')
        seen=[]
        def capture(t,cutoff,end):seen.append(cutoff);return t,[],True
        with patch.object(monitor.time,'time',return_value=4060),patch.object(monitor,'read',return_value={'items':[token],'nextCursor':None}),patch.object(monitor,'history',side_effect=capture):
            result=monitor.collect()
        self.assertEqual(seen,[1000])
        self.assertTrue(result['complete'])

    def test_many_tiny_buys_are_two_wallets_not_250_people(self):
        rows=[dict(trader='ALICE' if i%2 else 'bob',quoteAmount='0.2',txHash='0x'+'a'*64) for i in range(250)]
        m=purchase_metrics(rows)
        self.assertEqual((m['buys'],m['buyers'],m['volume'],m['median']), (250,2,'50.0','0.2'))
        self.assertEqual(m['top3Pct'],100)
        self.assertEqual(m['maximumTx'],'0x'+'a'*64)

    def test_missing_amount_is_unknown_not_zero_and_wallet_case_is_folded(self):
        m=purchase_metrics([dict(trader='ALICE',quoteAmount='NaN'),dict(trader='alice',quoteAmount=1)])
        self.assertEqual(m['buyers'],1)
        self.assertEqual(m['missingAmounts'],1)
        self.assertIsNone(m['volume']);self.assertIsNone(m['maximum'])
        self.assertEqual(purchase_metrics([])['volume'],'0')

    def test_first_hour_and_recent_windows_assets_and_empty_launch(self):
        tokens=[dict(address=str(i),createdAt=1000,deployer='owner',symbol='T',quote={'symbol':s,'address':str(i)},socials={'twitter':'https://x.com/token'}) for i,s in enumerate(['ETH','USDG','ETH'])]
        def row(id,ts,amount,who='alice',side='buy'):
            return dict(id=id,timestamp=ts,trader=who,side=side,venue='curve',quoteAmount=amount,txHash='0x'+'b'*64)
        eth=[row('early',1000,'1'),row('recent',3999,'0.1'),row('owner',3900,100,'OWNER'),row('sell',3900,10,side='sell'),row('future',4100,1000)]
        usd=[row('u',3999,50)]
        m=measure(tokens,[(tokens[0],eth+[eth[1]],True),(tokens[1],usd,True),(tokens[2],[],True)],4000)
        by={r['address']:r for r in m['board']}
        self.assertEqual(by['0']['lifetime']['volume'],'1.1')
        self.assertEqual(by['0']['recent']['volume'],'0.1')
        self.assertEqual(by['2']['recent']['buyers'],0)
        self.assertEqual({v['symbol']:v['volume'] for v in m['volumes']},{'ETH':'0.1','USDG':'50'})
        self.assertEqual(by['0']['twitter'],'https://x.com/token')
        self.assertEqual(measure(tokens,[(tokens[0],eth,True)],4600)['board'],[])

    def test_x_links_reject_spoofed_hosts_and_schemes(self):
        for value in ['javascript:alert(1)','https://x.com.evil/a','https://x.com@evil/a','https://u:p@x.com/a','http://x.com/a','https://x.com:123/a',None]:
            self.assertIsNone(social_url(value))
        self.assertEqual(social_url('https://twitter.com/example'),'https://twitter.com/example')

    def test_dedup_creator_age_and_boundaries(self):
        t=dict(address='token',createdAt=1000,deployer='OWNER',symbol='T',quote={'symbol':'USDG'})
        def trade(id, ts, who='buyer'):
            return dict(id=id,timestamp=ts,trader=who,side='buy',venue='curve',quoteAmount=10)
        rows=[trade('a',4400),trade('a',4400),trade('creator',4400,'owner'),trade('old',4600),trade('future',4700)]
        m=measure([t],[(t,rows,True)],4700)
        self.assertEqual(m['current']['buys'],1)
        self.assertEqual(m['current']['usdg'],10)
        self.assertFalse(m['candidate'])

    def test_broad_surge_and_no_zero_baseline_signal(self):
        tokens=[dict(address=str(i),createdAt=1000,deployer='owner',symbol='T',quote={'symbol':'ETH'}) for i in range(3)]
        hs=[]
        for i,t in enumerate(tokens):
            rows=[dict(id=f'live{j}',timestamp=3900,trader=f'b{i}-{j}',side='buy',venue='curve',quoteAmount=.1) for j in range(4)]
            rows += [dict(id=f'past{j}',timestamp=3600-300*j-1,trader=f'past{i}',side='buy',venue='curve',quoteAmount=.1) for j in range(6)]
            hs.append((t,rows,True))
        self.assertEqual(measure(tokens,hs,4000)['current']['buyers'],12)
        self.assertFalse(measure(tokens,hs,4000)['candidate'])
        only_live=[(t,[x for x in rows if x['timestamp']==3900],ok) for t,rows,ok in hs]
        self.assertFalse(measure(tokens,only_live,4000)['candidate'])

if __name__=='__main__':unittest.main()
