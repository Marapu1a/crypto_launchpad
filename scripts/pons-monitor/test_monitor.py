import unittest
from monitor import measure

class MetricsTests(unittest.TestCase):
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
        self.assertTrue(measure(tokens,hs,4000)['candidate'])
        only_live=[(t,[x for x in rows if x['timestamp']==3900],ok) for t,rows,ok in hs]
        self.assertFalse(measure(tokens,only_live,4000)['candidate'])

if __name__=='__main__':unittest.main()
