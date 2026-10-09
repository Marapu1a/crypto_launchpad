import assert from 'node:assert/strict';
import { ingestNext,applyNext } from '../../server/shared/chain-read.mjs';
import { inProject,createPool,verifyRole } from '../../server/shared/store.mjs';

export async function exerciseChainRead({admin,jobs,api,url,scenario,p1,p2,m1,m2,report}){
  const source='dddddddd-dddd-4ddd-8ddd-dddddddddddd',h=n=>'0x'+n.toString(16).padStart(64,'0'),a=n=>'0x'+n.toString(16).padStart(40,'0');
  const blocks=Array.from({length:4},(_,n)=>({number:'0x'+n,hash:h(100+n),parentHash:h(99+n),transactions:n?[1,2].map((token,i)=>({hash:h(n*10+i),blockHash:h(100+n),blockNumber:'0x'+n,transactionIndex:'0x'+i,to:a(9),input:'0x'})):[]}));
  let calls=0,missing=false,reorg=false,wrongChain=false,corrupt=false;
  const rpc={async send(method,params){calls++;
    if(method==='eth_chainId')return wrongChain?'0x1':'0x7a69';
    if(method==='eth_getBlockByNumber'){
      const b=structuredClone(blocks[Number(BigInt(params[0]))]);
      if(reorg&&b.number==='0x3')b.hash=h(999);
      return b;
    }
    if(method==='eth_getTransactionReceipt'){
      if(missing)return null;
      const b=blocks.find(b=>b.transactions.some(t=>t.hash===params[0])),i=b.transactions.findIndex(t=>t.hash===params[0]);
      const tx=b.transactions[i];
      return {transactionHash:tx.hash,blockHash:corrupt?h(999):b.hash,blockNumber:b.number,transactionIndex:tx.transactionIndex,status:'0x1',logs:[{address:a(i+1),blockHash:b.hash,blockNumber:b.number,transactionHash:tx.hash,transactionIndex:tx.transactionIndex,logIndex:'0x'+i,removed:false,topics:[],data:'0x'}]};
    }
    throw Error('Unexpected RPC method');
  }};
  const ingest=createPool(url('lp_ingest'));await verifyRole(ingest,'lp_ingest');
  const cursor=p=>inProject(jobs,p,c=>c.query('SELECT cursor_number FROM launchpad.read_subscriptions')).then(r=>r.rows[0].cursor_number);
  try{
    await admin.query('INSERT INTO launchpad.chain_sources VALUES($1,31337,$2,0,$2,0,$2,false)',[source,h(100)]);
    for(const [p,m] of [[p1,m1],[p2,m2]])await admin.query('INSERT INTO launchpad.read_subscriptions VALUES($1,$2,$3,0,$4)',[p,m,source,h(100)]);
    await scenario('Shared reader rejects incomplete/wrong-network evidence without advancing',async()=>{
      missing=true;await assert.rejects(ingestNext(ingest,rpc,source,3),/receipt/);missing=false;
      corrupt=true;await assert.rejects(ingestNext(ingest,rpc,source,3),/receipt/);corrupt=false;
      wrongChain=true;await assert.rejects(ingestNext(ingest,rpc,source,3),/network/);wrongChain=false;
      assert.equal((await admin.query('SELECT head_number FROM launchpad.chain_sources')).rows[0].head_number,'0');
      assert.equal((await admin.query('SELECT * FROM launchpad.chain_blocks')).rowCount,0);
    });
    await scenario('Three complete blocks fetched once; concurrent ingest and retries do not duplicate evidence',async()=>{
      calls=0;
      for(let n=1;n<=3;n++)assert.equal((await ingestNext(ingest,rpc,source,n)).number,n);
      const sharedCalls=calls;
      // Actual second independent source reading identical history: per-project baseline.
      const other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      await admin.query('INSERT INTO launchpad.chain_sources VALUES($1,31337,$2,0,$2,0,$2,false)',[other,h(100)]);
      calls=0;for(let n=1;n<=3;n++)await ingestNext(ingest,rpc,other,n);
      report.rpcComparison={blocks:3,projects:2,sharedCalls,separateCalls:sharedCalls+calls,savedCalls:calls,scope:'Synthetic RPC responses; actual send invocations, not a production benchmark'};
      assert.equal(sharedCalls,calls);assert.equal(sharedCalls,21);
      const results=await Promise.all([ingestNext(ingest,rpc,source,3),ingestNext(ingest,rpc,source,3)]);
      assert.ok(results.every(r=>r.status==='CAUGHT_UP'));
      assert.equal((await admin.query('SELECT * FROM launchpad.chain_blocks WHERE source_id=$1',[source])).rowCount,3);
    });
    await scenario('A missing stored block cannot be skipped by a consumer',async()=>{
      const {rows:[saved]}=await admin.query('DELETE FROM launchpad.chain_blocks WHERE source_id=$1 AND number=1 RETURNING *',[source]);
      await assert.rejects(applyNext(jobs,p1,m1),/Missing contiguous/);
      assert.equal(await cursor(p1),'0');
      assert.equal((await admin.query('SELECT * FROM launchpad.project_evidence')).rowCount,0);
      await admin.query('INSERT INTO launchpad.chain_blocks VALUES($1,$2,$3,$4)',[saved.source_id,saved.number,saved.hash,JSON.stringify(saved.evidence)]);
    });
    await scenario('Project failure/backlog does not stop its neighbour; apply retries and RLS isolate inboxes',async()=>{
      // Corrupt only A cursor to simulate an independent consumer failure.
      await admin.query('UPDATE launchpad.read_subscriptions SET cursor_hash=$2 WHERE project_id=$1',[p1,h(999)]);
      await assert.rejects(applyNext(jobs,p1,m1),/branch mismatch/);
      for(let n=1;n<=3;n++)await applyNext(jobs,p2,m2);
      assert.equal(await cursor(p1),'0');assert.equal(await cursor(p2),'3');
      await admin.query('UPDATE launchpad.read_subscriptions SET cursor_hash=$2 WHERE project_id=$1',[p1,h(100)]);
      const before=calls;
      await Promise.all([applyNext(jobs,p1,m1),applyNext(jobs,p1,m1)]);await applyNext(jobs,p1,m1);
      assert.equal((await applyNext(jobs,p1,m1)).status,'CAUGHT_UP');assert.equal(calls,before);
      for(const [p,token] of [[p1,1],[p2,2]])await inProject(jobs,p,async c=>{
        const rows=(await c.query('SELECT * FROM launchpad.project_evidence ORDER BY number')).rows;
        assert.equal(rows.length,3);assert.ok(rows.every(r=>r.project_id===p&&r.evidence.receipts.length===1&&r.evidence.receipts[0].logs[0].address===a(token)));
      });
      assert.equal((await jobs.query('SELECT * FROM launchpad.project_evidence')).rowCount,0);
      await assert.rejects(api.query('SELECT * FROM launchpad.chain_blocks'),e=>e.code==='42501');
      await assert.rejects(ingest.query('SELECT * FROM launchpad.project_evidence'),e=>e.code==='42501');
      await assert.rejects(jobs.query('DELETE FROM launchpad.chain_blocks'),e=>e.code==='42501');
    });
    await scenario('Reorg durably halts source and consumers without rewriting prior evidence',async()=>{
      const before=(await admin.query('SELECT * FROM launchpad.chain_blocks ORDER BY source_id,number')).rows;
      reorg=true;assert.equal((await ingestNext(ingest,rpc,source,3)).status,'HALTED_REORG');
      reorg=false;await assert.rejects(ingestNext(ingest,rpc,source,3),/halted/);
      await assert.rejects(applyNext(jobs,p1,m1),/halted/);await assert.rejects(applyNext(jobs,p2,m2),/halted/);
      assert.deepEqual((await admin.query('SELECT * FROM launchpad.chain_blocks ORDER BY source_id,number')).rows,before);
      assert.equal(await cursor(p1),'3');assert.equal(await cursor(p2),'3');
    });
  }finally{await ingest.end();}
}
