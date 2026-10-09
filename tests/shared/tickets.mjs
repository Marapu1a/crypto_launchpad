import assert from 'node:assert/strict';
import { readFileSync,mkdirSync,writeFileSync,unlinkSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { Contract,ContractFactory,id } from 'ethers';
import solc from 'solc';
import { providerFor } from '../../src/pons/client.mjs';
import { initialDraft,preparePlan,simulatePlan } from '../../src/pons/plan.mjs';
import { assertLocalFork,executeLocalLaunch,sendLocal } from '../../src/pons/local-execution.mjs';
import { createProfile,scanTickets } from '../../src/tickets/scanner.mjs';
import { digest,snapshotTickets } from '../../src/tickets/ledger.mjs';
import { bundleHash,creditedEvents } from '../../src/tickets/late-recognition.mjs';
import { createPool,inProject } from '../../server/shared/store.mjs';
import { ingestNext } from '../../server/shared/chain-read.mjs';
import { registerTicketShadow,applyTicketShadow,freezeShadowSnapshot,readTicketShadow } from '../../server/shared/ticket-shadow.mjs';
import { registerTicketLedger,applyTicketLedger,freezeLedgerSnapshot,readTicketLedger } from '../../server/shared/ticket-ledger.mjs';

export async function exerciseTicketShadow({admin,jobs,api,url,scenario,dir,report}){
  const provider=providerFor('http://127.0.0.1:8545'),ingest=createPool(url('lp_ingest'));
  const p1='33333333-3333-4333-8333-333333333333',p2='44444444-4444-4444-8444-444444444444';
  const m1='33333333-aaaa-4333-8333-333333333333',m2='44444444-bbbb-4444-8444-444444444444';
  const source='33333333-cccc-4333-8333-333333333333';
  const bundleDirectory=join(dir,'ticket-bundles');mkdirSync(bundleDirectory);
  const tx=async pending=>(await pending).wait();
  const head=async()=>Number(BigInt(await provider.send('eth_blockNumber',[])));
  const counts={};
  const counted={
    _getConnection:()=>provider._getConnection(),getNetwork:()=>provider.getNetwork(),
    call:request=>{counts.eth_call=(counts.eth_call??0)+1;return provider.call(request);},
    send:(method,params)=>{
      assert.notEqual(method,'eth_getTransactionReceipt','Shadow must read receipts from the shared database');
      if(method==='eth_getBlockByNumber')assert.equal(params[1],false,'Shadow must not download full blocks');
      counts[method]=(counts[method]??0)+1;return provider.send(method,params);
    }
  };
  try{
    report.ticketFork=await assertLocalFork(provider);
    const alice=await provider.getSigner(0),bob=await provider.getSigner(1),a=(await alice.getAddress()).toLowerCase(),b=(await bob.getAddress()).toLowerCase();
    const quote=new Contract('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)'],alice);
    const holder='0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e';
    await provider.send('hardhat_impersonateAccount',[holder]);await provider.send('hardhat_setBalance',[holder,'0x56bc75e2d63100000']);
    try{for(const recipient of [a,b]){
      const hash=await provider.send('eth_sendTransaction',[{from:holder,to:quote.target,data:quote.interface.encodeFunctionData('transfer',[recipient,100000000])}]);await provider.waitForTransaction(hash);
    }}finally{await provider.send('hardhat_stopImpersonatingAccount',[holder]);}
    const paths=['contracts/draws/LocalShortProgram.sol','contracts/draws/LocalPurchaseRecognition.sol'];
    const compilation=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:Object.fromEntries(paths.map(p=>[p,{content:readFileSync(p,'utf8')}])),settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{try{return {contents:readFileSync(resolve(p.startsWith('@')?'node_modules/'+p:p),'utf8')};}catch{return {error:p};}}}));
    assert.equal((compilation.errors??[]).filter(e=>e.severity==='error').length,0);
    const deploy=async(path,name,args)=>{const artifact=compilation.contracts[path][name];const c=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,alice).deploy(...args);await c.waitForDeployment();return c;};
    const program=await deploy(paths[0],'LocalShortProgram',[quote.target,a,1,1000000,1,[1]]);
    const otherProgram=await deploy(paths[0],'LocalShortProgram',[quote.target,a,1,1000000,1,[1]]);
    const instanceId=id('shared-shadow-'+program.target);
    const recognition=await deploy(paths[1],'LocalPurchaseRecognition',[instanceId,a]);
    const launch=async openingBuy=>{
      const draft={...initialDraft(),name:'Shadow Test',symbol:'SHADOW',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:quote.target,creatorFee:'1',openingBuy};
      let plan=await preparePlan(provider,draft,a);const journal=[];
      for(const step of plan.steps)await sendLocal(provider,a,step,journal,async()=>{},step.kind);
      plan=await simulatePlan(provider,await preparePlan(provider,draft,a));return executeLocalLaunch(provider,plan,journal,async()=>{});
    };
    const first=await launch('6'),second=await launch('1');
    const profile=await createProfile(provider,{token:first.token,program:program.target,launchBlock:first.block,thresholdRaw:'10000000',instance:'shared-alpha',recognition:{adapter:'local-verified-curve-v1',source:recognition.target,publisher:a,instanceId,deferDirectBuys:true}});
    const other=await createProfile(provider,{token:second.token,program:otherProgram.target,launchBlock:second.block,thresholdRaw:'1000000',instance:'shared-beta'});
    for(const [p,m,slug,pr] of [[p1,m1,'shadow-alpha',profile],[p2,m2,'shadow-beta',other]]){
      await admin.query('INSERT INTO launchpad.projects VALUES($1,$2,$2,31337,$3,\'shadow\')',[p,slug,pr.token.toLowerCase()]);
      await admin.query("INSERT INTO launchpad.module_instances VALUES($1,$2,'short','local-ticket-shadow-v1',$3,$4)",[p,m,pr.registry.toLowerCase(),digest(pr)]);
    }
    const genesis=await provider.send('eth_getBlockByNumber',['0x0',false]);
    await admin.query('INSERT INTO launchpad.chain_sources VALUES($1,31337,$2,$3,$4,$3,$4,false)',[source,genesis.hash,profile.anchor.number,profile.anchor.hash]);
    let ingested=profile.anchor.number;
    const ingestThrough=async cutoff=>{while(ingested<cutoff){const result=await ingestNext(ingest,provider,source,cutoff);assert.equal(result.status,'INGESTED');ingested=result.number;}};
    const curve=new Contract(first.curve,['function buy(uint256,uint256,address) returns(uint256)'],alice);
    await tx(quote.approve(curve.target,50000000));await tx(curve.buy(4000000,1,a));
    await tx(quote.connect(bob).approve(curve.target,25000000));await tx(curve.connect(bob).buy(25000000,1,b));
    const beforeCredit=await head();await ingestThrough(beforeCredit);
    const oldPath=join(dir,'legacy-alpha.json'),otherPath=join(dir,'legacy-beta.json');
    const comparable=s=>({profile:s.profile,head:s.head,blocks:s.blocks,wallets:s.wallets});
    let old,shadow,frozen,bundle,key;
    const ledgerStats=[];
    const compareLedger=async(p,m,reference)=>{
      const result=await readTicketLedger(jobs,p,m);
      assert.deepEqual(result,{profile:reference.profile,head:reference.head,wallets:reference.wallets});
    };
    await scenario('Ticket shadow verifies project bindings and matches legacy scanner on real fork receipts',async()=>{
      await assert.rejects(registerTicketShadow(jobs,provider,p2,m2,source,profile),/binding mismatch/);
      await registerTicketShadow(jobs,provider,p1,m1,source,profile);await registerTicketShadow(jobs,provider,p2,m2,source,other);
      await registerTicketLedger(jobs,provider,p1,m1,source,profile);await registerTicketLedger(jobs,provider,p2,m2,source,other);
      await assert.rejects(registerTicketShadow(jobs,provider,p1,m1,source,{...profile,thresholdRaw:'0'}),/threshold/);
      old=await scanTickets(provider,profile,oldPath,beforeCredit);
      shadow=await applyTicketShadow(jobs,counted,p1,m1,beforeCredit);
      assert.deepEqual(comparable(shadow),comparable(old));
      ledgerStats.push(await applyTicketLedger(jobs,counted,p1,m1,beforeCredit));await compareLedger(p1,m1,old);
      assert.equal(shadow.wallets[a].tickets,'0');assert.equal(shadow.wallets[a].remainder,'6000000');
      assert.equal(counts.eth_getTransactionReceipt??0,0);
      const original=shadow.blocks.flatMap(block=>block.events).find(e=>e.status==='WAITING_RECOGNITION'&&e.netQuoteDebitRaw==='4000000');assert.ok(original);
      bundle={schema:'launchpad-local-recognition-v1',profileHash:digest(profile),candidates:[original.candidateId]};key=bundleHash(bundle);
      frozen=await freezeShadowSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit);
      assert.deepEqual(frozen,snapshotTickets(old,beforeCredit));assert.deepEqual(frozen.participants,[]);
      assert.deepEqual(await freezeLedgerSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit),frozen);
      const foreign=await readTicketShadow(jobs,p2,m1);assert.equal(foreign,null);
      assert.equal((await jobs.query('SELECT * FROM launchpad.ticket_shadows')).rowCount,0);
      await assert.rejects(api.query('SELECT * FROM launchpad.ticket_shadows'),e=>e.code==='42501');
      await assert.rejects(inProject(jobs,p1,c=>c.query("UPDATE launchpad.ticket_shadows SET profile_hash=$1",['f'.repeat(64)]),{readOnly:false}),e=>e.code==='42501');
    });
    const confirmation=await tx(recognition.confirm(key,1));await ingestThrough(await head());
    await scenario('Missing/corrupt late bundle rolls back A while B progresses with its own threshold',async()=>{
      const before=await readTicketShadow(jobs,p1,m1);
      const ledgerBefore=await readTicketLedger(jobs,p1,m1);
      await assert.rejects(applyTicketLedger(jobs,provider,p1,m1,await head(),{bundleDirectory}),/ENOENT/);
      assert.deepEqual(await readTicketLedger(jobs,p1,m1),ledgerBefore);
      await assert.rejects(applyTicketShadow(jobs,provider,p1,m1,await head(),{bundleDirectory}),/ENOENT/);
      assert.deepEqual(await readTicketShadow(jobs,p1,m1),before);
      writeFileSync(join(bundleDirectory,key+'.json'),JSON.stringify({...bundle,profileHash:'wrong'}));
      await assert.rejects(applyTicketShadow(jobs,provider,p1,m1,await head(),{bundleDirectory}),/hash mismatch/);
      await assert.rejects(applyTicketLedger(jobs,provider,p1,m1,await head(),{bundleDirectory}),/hash mismatch/);
      assert.deepEqual(await readTicketLedger(jobs,p1,m1),ledgerBefore);
      assert.deepEqual(await readTicketShadow(jobs,p1,m1),before);
      const beta=await applyTicketShadow(jobs,counted,p2,m2,await head());
      assert.deepEqual(comparable(beta),comparable(await scanTickets(provider,other,otherPath,await head())));
      assert.equal(beta.wallets[a].tickets,'1');assert.equal(beta.wallets[a].remainder,'0');
      await applyTicketLedger(jobs,counted,p2,m2,await head());await compareLedger(p2,m2,beta);
      writeFileSync(join(bundleDirectory,key+'.json'),JSON.stringify(bundle));
    });
    await scenario('Late creditedAt, exact profile JSON, frozen cutoff and concurrent retries match legacy',async()=>{
      const cutoff=await head();
      const states=await Promise.all([applyTicketShadow(jobs,counted,p1,m1,cutoff,{bundleDirectory}),applyTicketShadow(jobs,counted,p1,m1,cutoff,{bundleDirectory})]);
      assert.deepEqual(states[0],states[1]);shadow=states[0];old=await scanTickets(provider,profile,oldPath,cutoff,{bundleDirectory});
      assert.deepEqual(comparable(shadow),comparable(old));
      const applied=await Promise.all([applyTicketLedger(jobs,counted,p1,m1,cutoff,{bundleDirectory}),applyTicketLedger(jobs,counted,p1,m1,cutoff,{bundleDirectory})]);
      assert.deepEqual(applied.map(x=>x.blocksRead).sort(),[0,1]);
      assert.equal(applied.reduce((n,x)=>n+x.creditsAdded,0),1);ledgerStats.push(...applied);await compareLedger(p1,m1,old);
      assert.equal(shadow.wallets[a].tickets,'1');assert.equal(shadow.wallets[a].remainder,'0');
      const credit=creditedEvents(shadow).find(e=>e.candidateId===bundle.candidates[0]);assert.equal(credit.creditedAt.blockNumber,confirmation.blockNumber);
      assert.deepEqual(snapshotTickets(shadow,beforeCredit),frozen);
      assert.deepEqual(await freezeLedgerSnapshot(jobs,provider,p1,m1,'old-cutoff-again',beforeCredit),frozen);
      assert.deepEqual(await freezeLedgerSnapshot(jobs,provider,p1,m1,'after-credit',cutoff,{[a]:'1'}),snapshotTickets(old,cutoff,{[a]:'1'}));
      await assert.rejects(freezeLedgerSnapshot(jobs,provider,p1,m1,'before-credit',cutoff),/already frozen/);
      assert.deepEqual(await freezeShadowSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit),frozen);
      await assert.rejects(freezeShadowSnapshot(jobs,provider,p1,m1,'before-credit',cutoff),/already frozen/);
      await assert.rejects(freezeShadowSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit,{[a]:'0'}),/already frozen/);
      assert.deepEqual(snapshotTickets(shadow,cutoff,{[a]:'1'}),snapshotTickets(old,cutoff,{[a]:'1'}));
      const {rows:[row]}=await inProject(jobs,p1,c=>c.query('SELECT profile_text FROM launchpad.ticket_shadows'));
      assert.equal(row.profile_text,JSON.stringify(profile));
    });
    await scenario('Restart needs no old bundle files; a new delivery does not double-credit',async()=>{
      unlinkSync(join(bundleDirectory,key+'.json'));
      const restarted=createPool(url('lp_jobs'));
      try{
        assert.deepEqual(await applyTicketShadow(restarted,provider,p1,m1,await head()),shadow);
        const retry=await applyTicketLedger(restarted,counted,p1,m1,await head());
        assert.equal(retry.blocksRead,0);assert.equal(retry.proofRowsRead,0);assert.equal(retry.creditsAdded,0);
      }finally{await restarted.end();}
      const repeat={...bundle,delivery:'retry'},repeatKey=bundleHash(repeat);
      writeFileSync(join(bundleDirectory,repeatKey+'.json'),JSON.stringify(repeat));
      await tx(recognition.confirm(repeatKey,1));await ingestThrough(await head());
      shadow=await applyTicketShadow(jobs,counted,p1,m1,await head(),{bundleDirectory});
      old=await scanTickets(provider,profile,oldPath,await head(),{bundleDirectory});
      const repeated=await applyTicketLedger(jobs,counted,p1,m1,await head(),{bundleDirectory});
      assert.equal(repeated.blocksRead,1);assert.equal(repeated.proofRowsRead,1);assert.equal(repeated.creditsAdded,0);ledgerStats.push(repeated);
      await compareLedger(p1,m1,old);
      assert.deepEqual(comparable(shadow),comparable(old));assert.equal(shadow.wallets[a].tickets,'1');
      assert.equal(creditedEvents(shadow).find(e=>e.candidateId===bundle.candidates[0]).creditedAt.blockNumber,confirmation.blockNumber);
      assert.deepEqual(await freezeShadowSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit),frozen);
    });
    await scenario('Normalized ledger keeps originals/credits immutable, scopes rows and rejects partial writes',async()=>{
      for(const table of ['ticket_ledgers','ticket_events','ticket_credits','ticket_wallets','ticket_commitments','ticket_snapshots']){
        assert.equal((await jobs.query('SELECT * FROM launchpad.'+table)).rowCount,0);
        await assert.rejects(api.query('SELECT * FROM launchpad.'+table),e=>e.code==='42501');
      }
      for(const table of ['ticket_events','ticket_credits','ticket_commitments','ticket_snapshots']){
        await assert.rejects(inProject(jobs,p1,c=>c.query('DELETE FROM launchpad.'+table),{readOnly:false}),e=>e.code==='42501');
      }
      const {rows}=await inProject(jobs,p1,c=>c.query(`SELECT e.payload_text,c.event_text,c.credited_block FROM launchpad.ticket_events e
        JOIN launchpad.ticket_credits c USING(project_id,module_id,candidate_id) WHERE e.candidate_id=$1`,[bundle.candidates[0]]));
      assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].payload_text).event.status,'WAITING_RECOGNITION');
      assert.equal(JSON.parse(rows[0].event_text).creditedAt.blockNumber,confirmation.blockNumber);
      assert.equal(Number(rows[0].credited_block),confirmation.blockNumber);
      assert.equal(await readTicketLedger(jobs,p2,m1),null);
      // Failure after inserting an eligible event/credit must roll back wallet and cursor too.
      const before=await readTicketLedger(jobs,p2,m2);
      const otherCurve=new Contract(second.curve,['function buy(uint256,uint256,address) returns(uint256)'],alice);
      await tx(quote.approve(otherCurve.target,1000000));await tx(otherCurve.buy(1000000,1,a));await ingestThrough(await head());
      const countsBefore=await inProject(jobs,p2,c=>c.query('SELECT (SELECT count(*) FROM launchpad.ticket_events) AS events,(SELECT count(*) FROM launchpad.ticket_credits) AS credits'));
      await admin.query(`CREATE FUNCTION launchpad.test_reject_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ledger failure'; END $$;
        CREATE TRIGGER test_reject_cursor BEFORE UPDATE ON launchpad.ticket_ledgers FOR EACH ROW EXECUTE FUNCTION launchpad.test_reject_cursor()`);
      try{await assert.rejects(applyTicketLedger(jobs,provider,p2,m2,await head()),/injected ledger failure/);}finally{await admin.query('DROP TRIGGER test_reject_cursor ON launchpad.ticket_ledgers; DROP FUNCTION launchpad.test_reject_cursor()');}
      assert.deepEqual(await readTicketLedger(jobs,p2,m2),before);
      assert.deepEqual((await inProject(jobs,p2,c=>c.query('SELECT (SELECT count(*) FROM launchpad.ticket_events) AS events,(SELECT count(*) FROM launchpad.ticket_credits) AS credits'))).rows,countsBefore.rows);
      await applyTicketLedger(jobs,provider,p2,m2,await head());
      await compareLedger(p2,m2,await scanTickets(provider,other,otherPath,await head()));
      await applyTicketLedger(jobs,provider,p1,m1,await head());
    });
    await scenario('Runtime/profile drift and reorg cannot advance tickets or replace frozen snapshots',async()=>{
      const before=await readTicketShadow(jobs,p1,m1);
      const wrong={...counted,send:(method,args)=>method==='hardhat_metadata'?Promise.resolve({...report.ticketFork,instanceId:id('wrong')}):counted.send(method,args)};
      await assert.rejects(applyTicketShadow(jobs,wrong,p1,m1,await head()),/Different fork/);
      await assert.rejects(applyTicketLedger(jobs,wrong,p1,m1,await head()),/Different fork/);
      const drift={...counted,send:(method,args)=>method==='eth_getCode'&&args[0].toLowerCase()===recognition.target.toLowerCase()?Promise.resolve('0x'):counted.send(method,args)};
      await assert.rejects(applyTicketShadow(jobs,drift,p1,m1,await head()),/Recognition runtime changed/);
      await assert.rejects(applyTicketLedger(jobs,drift,p1,m1,await head()),/Recognition runtime changed/);
      assert.deepEqual(await readTicketShadow(jobs,p1,m1),before);
      const {rows:[stored]}=await inProject(jobs,p1,c=>c.query('SELECT state_text FROM launchpad.ticket_shadows'));
      await admin.query("UPDATE launchpad.ticket_shadows SET state_text='{}' WHERE project_id=$1",[p1]);
      await assert.rejects(applyTicketShadow(jobs,provider,p1,m1,await head()),/checksum/);
      await admin.query('UPDATE launchpad.ticket_shadows SET state_text=$2 WHERE project_id=$1',[p1,stored.state_text]);
      assert.deepEqual(await readTicketShadow(jobs,p1,m1),before);
      const evm=await provider.send('evm_snapshot',[]);
      await tx(curve.buy(1000000,1,a));await ingestThrough(await head());
      await applyTicketShadow(jobs,provider,p1,m1,await head());
      const orphan=await readTicketShadow(jobs,p1,m1);
      await provider.send('evm_revert',[evm]);
      // Mine a distinct replacement at the same height so the shared reader records halt.
      await provider.send('evm_mine',[]);
      assert.equal((await ingestNext(ingest,provider,source,await head())).status,'HALTED_REORG');
      const ledgerBefore=await readTicketLedger(jobs,p1,m1);
      await assert.rejects(applyTicketLedger(jobs,provider,p1,m1,await head()),/halted/);
      await assert.rejects(freezeLedgerSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit),/halted/);
      assert.deepEqual(await readTicketLedger(jobs,p1,m1),ledgerBefore);
      await assert.rejects(applyTicketShadow(jobs,provider,p1,m1,await head()),/halted/);
      await assert.rejects(freezeShadowSnapshot(jobs,provider,p1,m1,'before-credit',beforeCredit),/halted/);
      assert.deepEqual(await readTicketShadow(jobs,p1,m1),orphan);
      assert.deepEqual(orphan.snapshots['before-credit'].snapshot,frozen);
    });
    report.ticketShadow={projects:[p1,p2],source,token:first.token,secondToken:second.token,beforeCredit,confirmationBlock:confirmation.blockNumber,rpcVerificationCalls:counts,ledgerStats,scope:'Local fork only; full raw receipts shared, per-profile read-only verification RPC retained; no production or financial worker switch'};
  }finally{await ingest.end();provider.destroy();}
}
